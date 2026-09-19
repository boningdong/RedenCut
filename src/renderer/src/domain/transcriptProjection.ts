import { hasValidatedTiming } from './transcriptReliability'
import { redactionCoverage } from '@shared/ClipRedactions'
import type { Clip, TrackContent } from '@shared/ProjectTypes'
import type { RendererSpeechAnalysis, TranscriptUnit, SpeakerId } from '@shared/speech.types'

/** An occurrence is the unit as heard through one current timeline clip. */
export interface TranscriptOccurrence {
  id: string
  scopeId: string
  analysis: RendererSpeechAnalysis
  track: TrackContent
  clip: Clip
  unit: TranscriptUnit
  sourceStart: number | null
  sourceEnd: number | null
  outputStart: number | null
  outputEnd: number | null
  orderTime: number
  leadingSpace: boolean
  partial: boolean
  muted: boolean
  redaction?: 'none' | 'partial' | 'full'
  speakerId?: SpeakerId
  contextSpeakerId?: SpeakerId
  ambiguous: boolean
  timingOrigin?: RendererSpeechAnalysis['alignment']['acousticEditUnits'][number]['timingOrigin']
  acousticUnitSize?: number
}
export interface TranscriptOverlap {
  start: number
  end: number
  trackIds: string[]
}

export function projectTranscript(
  analyses: RendererSpeechAnalysis[],
  tracks: TrackContent[],
): TranscriptOccurrence[] {
  const result: TranscriptOccurrence[] = []
  const solo = tracks.some((track) => track.solo)
  const indexed = new Map(
    analyses.map((analysis) => {
      const acousticByUnit = new Map(
        analysis.alignment.acousticEditUnits.flatMap((a) =>
          a.transcriptUnitIds.map((id) => [id, a] as const),
        ),
      )
      const attribution = new Map(
        (analysis.speakerAttribution?.attributions ?? []).map((a) => [a.acousticEditUnitId, a]),
      )
      const nearest: Array<number | undefined> = []
      let previous: number | undefined
      for (let i = 0; i < analysis.transcript.units.length; i++) {
        if (acousticByUnit.has(analysis.transcript.units[i].id)) previous = i
        nearest[i] = previous
      }
      let next: number | undefined
      for (let i = analysis.transcript.units.length - 1; i >= 0; i--) {
        if (acousticByUnit.has(analysis.transcript.units[i].id)) next = i
        if (next !== undefined && (nearest[i] === undefined || next - i < i - nearest[i]!))
          nearest[i] = next
      }
      return [analysis.audioSourceId, { analysis, acousticByUnit, attribution, nearest }] as const
    }),
  )
  for (const track of tracks)
    for (const clip of track.clips) {
      const indexData = indexed.get(clip.audioSourceId)
      if (!indexData) continue
      const { analysis, acousticByUnit, attribution, nearest } = indexData
      const included = new Set(
        analysis.alignment.acousticEditUnits
          .filter((a) => a.sourceStart < clip.sourceEnd && a.sourceEnd > clip.sourceStart)
          .flatMap((a) => a.transcriptUnitIds),
      )
      // Nearest timed neighbors locate untimed text in reading order without fabricating audio bounds.
      for (let index = 0; index < analysis.transcript.units.length; index++) {
        const unit = analysis.transcript.units[index],
          acoustic = acousticByUnit.get(unit.id)
        const neighbor = nearest[index]
        if (
          acoustic
            ? !included.has(unit.id)
            : neighbor !== undefined && !included.has(analysis.transcript.units[neighbor].id)
        )
          continue
        const sourceStart = acoustic ? Math.max(acoustic.sourceStart, clip.sourceStart) : null
        const sourceEnd = acoustic ? Math.min(acoustic.sourceEnd, clip.sourceEnd) : null
        const outputStart =
          sourceStart === null ? null : clip.outputStart + sourceStart - clip.sourceStart
        const outputEnd =
          sourceEnd === null ? null : clip.outputStart + sourceEnd - clip.sourceStart
        const anchor =
          neighbor === undefined
            ? undefined
            : acousticByUnit.get(analysis.transcript.units[neighbor].id)
        const orderTime =
          outputStart ??
          (anchor
            ? clip.outputStart + Math.max(anchor.sourceStart, clip.sourceStart) - clip.sourceStart
            : clip.outputStart)
        const speaker = acoustic ? attribution.get(acoustic.id) : undefined
        const redaction =
          sourceStart !== null && sourceEnd !== null
            ? redactionCoverage(clip, sourceStart, sourceEnd)
            : 'none'
        const scopeId = JSON.stringify([
          analysis.audioSourceId,
          analysis.analysisRevisionId,
          track.id,
          clip.id,
        ])
        result.push({
          id: JSON.stringify([scopeId, unit.id]),
          scopeId,
          analysis,
          track,
          clip,
          unit,
          sourceStart,
          sourceEnd,
          outputStart: hasValidatedTiming(analysis) ? outputStart : null,
          outputEnd: hasValidatedTiming(analysis) ? outputEnd : null,
          orderTime,
          leadingSpace:
            index > 0 &&
            unit.kind === 'speech' &&
            /^[\p{L}\p{N}]/u.test(unit.text) &&
            !/^\p{Script=Han}/u.test(unit.text) &&
            /[\p{L}\p{N}.!?,;:]$/u.test(analysis.transcript.units[index - 1].text) &&
            !/\p{Script=Han}$/u.test(analysis.transcript.units[index - 1].text),
          partial: Boolean(
            acoustic && (sourceStart !== acoustic.sourceStart || sourceEnd !== acoustic.sourceEnd),
          ),
          redaction,
          muted: clip.muted || track.muted || (solo && !track.solo) || redaction === 'full',
          speakerId: speaker?.ambiguous ? undefined : speaker?.speakerId,
          contextSpeakerId:
            !acoustic && anchor && !attribution.get(anchor.id)?.ambiguous
              ? attribution.get(anchor.id)?.speakerId
              : undefined,
          ambiguous: speaker?.ambiguous ?? false,
          timingOrigin: acoustic?.timingOrigin,
          acousticUnitSize: acoustic?.transcriptUnitIds.length,
        })
      }
    }
  return result.sort((a, b) => a.orderTime - b.orderTime)
}

/** Half-open intervals ensure adjacent turns never count as simultaneous speech. */
export function findTranscriptOverlaps(units: TranscriptOccurrence[]): TranscriptOverlap[] {
  const audible = units.filter(
    (u) => !u.muted && u.unit.kind === 'speech' && u.outputStart !== null && u.outputEnd !== null,
  )
  const events = audible
    .flatMap((u) => [
      { time: u.outputStart!, trackId: u.track.id, delta: 1 },
      { time: u.outputEnd!, trackId: u.track.id, delta: -1 },
    ])
    .sort((a, b) => a.time - b.time)
  const active = new Map<string, number>()
  const result: TranscriptOverlap[] = []
  let index = 0
  while (index < events.length) {
    const start = events[index].time
    while (index < events.length && events[index].time === start) {
      const event = events[index++],
        count = (active.get(event.trackId) ?? 0) + event.delta
      if (count) active.set(event.trackId, count)
      else active.delete(event.trackId)
    }
    if (index === events.length || active.size < 2) continue
    const end = events[index].time,
      trackIds = [...active.keys()].sort(),
      previous = result[result.length - 1]
    if (previous && previous.end === start && previous.trackIds.join('\0') === trackIds.join('\0'))
      previous.end = end
    else result.push({ start, end, trackIds })
  }
  return result
}
