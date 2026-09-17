import { planSpeechTasks, type SpeechTaskSelection } from '../../shared/SpeechTaskPlanner'
import type { AudioSourceId } from '../../shared/source.types'
import type { SpeechArtifact } from '../../shared/speechArtifact.schema'
import type { PublicMessage, SpeechProgress } from '../../shared/publicMessages'
import type {
  SpeechBatchPhase,
  SpeechBatchProgress,
  SpeechBatchSummary,
} from '../../shared/speechBatch.types'

export interface SpeechBatchSource {
  audioSourceId: AudioSourceId
  displayName: string
  artifact?: SpeechArtifact
}
interface BatchOperations {
  analyzeText(
    source: SpeechBatchSource,
    signal: AbortSignal,
    progress: (event: SpeechProgress) => void,
  ): Promise<SpeechArtifact>
  analyzeSpeakers(
    source: SpeechBatchSource,
    artifact: SpeechArtifact,
    signal: AbortSignal,
    progress: (event: SpeechProgress) => void,
  ): Promise<SpeechArtifact>
  publish(source: SpeechBatchSource, artifact: SpeechArtifact, signal: AbortSignal): Promise<void>
  publicFailure(error: unknown, phase: SpeechBatchPhase): PublicMessage
}

/** Own sequencing and partial outcomes; engines, persistence and IPC stay behind callbacks. */
export class SpeechBatchCoordinator {
  constructor(private readonly operations: BatchOperations) {}

  async run(
    input: readonly SpeechBatchSource[],
    selection: SpeechTaskSelection,
    signal: AbortSignal,
    onProgress: (event: SpeechProgress, batch: SpeechBatchProgress) => void = () => {},
  ): Promise<SpeechBatchSummary> {
    const sources = input.map((source) => ({ ...source }))
    const plan = planSpeechTasks(
      sources.map((source) => ({
        audioSourceId: source.audioSourceId,
        text: !!source.artifact,
        speakers: !!source.artifact?.diarization,
      })),
      selection,
    )
    if (plan.missingText.length)
      throw new Error('Speaker recognition requires an aligned transcript')
    const summary: SpeechBatchSummary = {
      sourceCount: sources.length,
      completedCount: 0,
      reusedCount: 0,
      failures: [],
      cancelled: false,
    }
    const failed = new Set<AudioSourceId>()
    const completed = new Set<AudioSourceId>()
    for (const source of sources) {
      if (
        !plan.text.includes(source.audioSourceId) &&
        !plan.speakers.includes(source.audioSourceId)
      ) {
        completed.add(source.audioSourceId)
        summary.reusedCount++
      }
    }
    for (const phase of ['text', 'speakers'] as const) {
      const targets = sources.filter((source) => plan[phase].includes(source.audioSourceId))
      for (const [index, source] of targets.entries()) {
        if (signal.aborted) break
        if (failed.has(source.audioSourceId) || completed.has(source.audioSourceId)) continue
        const batch: SpeechBatchProgress = {
          phase,
          sourceIndex: index + 1,
          sourceCount: targets.length,
          audioSourceId: source.audioSourceId,
          displayName: source.displayName,
        }
        const progress = (event: SpeechProgress) => {
          if (!signal.aborted) onProgress(event, batch)
        }
        try {
          progress({ stage: 'preparing-audio' })
          const artifact =
            phase === 'text'
              ? await this.operations.analyzeText(source, signal, progress)
              : await this.operations.analyzeSpeakers(source, source.artifact!, signal, progress)
          signal.throwIfAborted()
          progress({ stage: 'publishing' })
          await this.operations.publish(source, artifact, signal)
          source.artifact = artifact
          if (!plan.speakers.includes(source.audioSourceId) || phase === 'speakers')
            completed.add(source.audioSourceId)
        } catch (error) {
          if (signal.aborted) break
          failed.add(source.audioSourceId)
          summary.failures.push({
            audioSourceId: source.audioSourceId,
            displayName: source.displayName,
            phase,
            error: this.operations.publicFailure(error, phase),
          })
        }
      }
      if (signal.aborted) break
    }
    summary.cancelled = signal.aborted
    summary.completedCount = completed.size
    return summary
  }
}
