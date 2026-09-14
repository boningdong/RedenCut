import type { AudioSourceCacheDescriptor } from '../../shared/import.types'
import { ProjectFileSchema, type ProjectFile } from '../../shared/project.types'
import type { ProjectDraft, RendererSession, WorkspaceToken } from '../../shared/session.types'
import type { RendererSpeechAnalysis } from '../../shared/speech.types'
import type { ProjectWorkspace } from './ProjectWorkspace'

export function toRendererSession(
  workspace: Pick<ProjectWorkspace, 'project' | 'descriptor' | 'speechArtifacts'>,
  workspaceToken: WorkspaceToken,
  revision: number,
  descriptors: AudioSourceCacheDescriptor[],
): RendererSession {
  const descriptorsBySourceId = new Map(
    descriptors.map((descriptor) => [descriptor.audioSourceId, descriptor]),
  )

  return {
    workspaceToken,
    revision,
    workspace: workspace.descriptor,
    sources: workspace.project.audioSources.map((source) => {
      const cache = descriptorsBySourceId.get(source.id)
      if (!cache) throw new Error(`Missing cache descriptor for audio source ${source.id}`)
      return { id: source.id, displayName: source.displayName, metadata: source.metadata, cache }
    }),
    draft: {
      tracks: workspace.project.tracks,
      export: workspace.project.export,
    },
    speechAnalyses: workspace.speechArtifacts.map((artifact) =>
      toRendererSpeechAnalysis(artifact, workspace.project),
    ),
  }
}

function toRendererSpeechAnalysis(
  artifact: ProjectWorkspace['speechArtifacts'][number],
  project: ProjectFile,
): RendererSpeechAnalysis {
  const overrides = project.speakerLabelOverrides
    .filter(
      (override) =>
        override.audioSourceId === artifact.audioSourceId &&
        override.analysisRevisionId === artifact.analysisRevisionId,
    )
    .map(({ speakerId, displayName, color }) => ({
      speakerId,
      displayName,
      ...(color ? { color } : {}),
    }))
  const {
    id: transcriptId,
    revision,
    units,
    mode,
    provenance: transcriptProvenance,
  } = artifact.transcript
  const {
    id: alignmentId,
    transcriptArtifactId,
    transcriptRevision,
    acousticEditUnits,
    provenance: alignmentProvenance,
  } = artifact.alignment
  const diarization = artifact.diarization
  return {
    audioSourceId: artifact.audioSourceId,
    analysisRevisionId: artifact.analysisRevisionId,
    transcript: { id: transcriptId, revision, units, mode, provenance: transcriptProvenance },
    alignment: {
      id: alignmentId,
      transcriptArtifactId,
      transcriptRevision,
      acousticEditUnits,
      provenance: alignmentProvenance,
    },
    diarizationStatus: artifact.schemaVersion === 1 ? 'completed' : artifact.diarizationStatus,
    ...(diarization
      ? {
          diarization: {
            id: diarization.id,
            turns: diarization.turns,
            provenance: diarization.provenance,
          },
        }
      : {}),
    speakerAttribution: artifact.speakerAttribution,
    speakers: artifact.speakers,
    speakerLabelOverrides: overrides,
  }
}

export function mergeProjectDraft(authoritative: ProjectFile, draft: ProjectDraft): ProjectFile {
  return ProjectFileSchema.parse({
    ...authoritative,
    tracks: draft.tracks,
    export: draft.export,
  })
}
