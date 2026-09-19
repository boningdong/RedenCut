import type { AudioSourceId, ProjectFile } from '../../shared/ProjectTypes'
import type { AudioSourceFingerprint } from '../../shared/source.types'
import type { SessionPrecondition, WorkspaceToken } from '../../shared/session.types'

export interface BackgroundSpeechGuard {
  readonly workspaceToken: WorkspaceToken
  readonly audioSourceId: AudioSourceId
  readonly sourceFingerprint: AudioSourceFingerprint
  readonly expectedSpeakerLabelOverrides: ProjectFile['speakerLabelOverrides']
  readonly expectedAnalysis: Pick<
    ProjectFile['speechArtifacts'][number],
    'analysisRevisionId' | 'artifactSha256'
  > | null
}

export function captureSpeechGuard(
  project: ProjectFile,
  expected: Pick<SessionPrecondition, 'workspaceToken'>,
  audioSourceId: AudioSourceId,
): BackgroundSpeechGuard {
  const source = project.audioSources.find((source) => source.id === audioSourceId)
  if (!source) throw new Error('Speech analysis references an unknown AudioSource')
  const analysis = project.speechArtifacts.find(
    (artifact) => artifact.audioSourceId === audioSourceId,
  )
  return {
    workspaceToken: expected.workspaceToken,
    audioSourceId,
    sourceFingerprint: { ...source.fingerprint },
    expectedSpeakerLabelOverrides: project.speakerLabelOverrides
      .filter((override) => override.audioSourceId === audioSourceId)
      .map((override) => ({ ...override })),
    expectedAnalysis: analysis
      ? { analysisRevisionId: analysis.analysisRevisionId, artifactSha256: analysis.artifactSha256 }
      : null,
  }
}

export function assertSpeechGuard(project: ProjectFile, guard: BackgroundSpeechGuard): void {
  const current = captureSpeechGuard(project, guard, guard.audioSourceId)
  if (
    current.sourceFingerprint.byteLength !== guard.sourceFingerprint.byteLength ||
    current.sourceFingerprint.modifiedTimeMs !== guard.sourceFingerprint.modifiedTimeMs ||
    current.sourceFingerprint.sha256 !== guard.sourceFingerprint.sha256
  )
    throw new Error('Speech analysis source fingerprint is stale')
  if (
    current.expectedAnalysis?.analysisRevisionId !== guard.expectedAnalysis?.analysisRevisionId ||
    current.expectedAnalysis?.artifactSha256 !== guard.expectedAnalysis?.artifactSha256
  )
    throw new Error('Speech analysis artifact is stale')
  if (
    JSON.stringify(current.expectedSpeakerLabelOverrides) !==
    JSON.stringify(guard.expectedSpeakerLabelOverrides)
  )
    throw new Error('Speech analysis speaker labels are stale')
}
