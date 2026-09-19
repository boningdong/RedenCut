import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { resolve, join } from 'node:path'
import { expect, test } from 'vitest'
import { ProjectFileSchema } from '../../src/shared/ProjectTypes'
import { SpeechArtifactSchema } from '../../src/shared/speechArtifact.schema'

test.each(['transcript-editing-high-precision.redencut', 'transcript-editing.redencut'])(
  'saved fixture %s has self-contained media and matching speech artifacts',
  (name) => {
    const root = resolve('e2e/fixtures/projects', name)
    const project = ProjectFileSchema.parse(
      JSON.parse(readFileSync(join(root, 'project.json'), 'utf8')),
    )
    expect(project.audioSources.length).toBeGreaterThan(0)
    expect(project.tracks[0].clips).toHaveLength(1)
    for (const source of project.audioSources) {
      expect(source.location.mode).toBe('copy')
      const bytes = readFileSync(join(root, source.location.path))
      expect(bytes.byteLength).toBe(source.fingerprint.byteLength)
      expect(createHash('sha256').update(bytes).digest('hex')).toBe(source.fingerprint.sha256)
    }
    expect(project.speechArtifacts).toHaveLength(project.audioSources.length)
    for (const ref of project.speechArtifacts) {
      const bytes = readFileSync(join(root, ref.artifactPath))
      expect(bytes.byteLength).toBe(ref.artifactByteLength)
      expect(createHash('sha256').update(bytes).digest('hex')).toBe(ref.artifactSha256)
      const artifact = SpeechArtifactSchema.parse(JSON.parse(bytes.toString()))
      expect(artifact.audioSourceId).toBe(ref.audioSourceId)
      expect(artifact.analysisRevisionId).toBe(ref.analysisRevisionId)
      expect(artifact.sourceFingerprint).toEqual(ref.sourceFingerprint)
      expect(artifact.alignment.validation?.method).toBe('audio-evidence')
      expect(artifact.transcript.units).toHaveLength(ref.summary.transcriptUnitCount)
      expect(artifact.alignment.acousticEditUnits).toHaveLength(ref.summary.acousticEditUnitCount)
      expect(artifact.speakers).toHaveLength(ref.summary.speakerCount)
      expect(artifact.transcript.units.length).toBeGreaterThan(0)
      const source = project.audioSources.find((source) => source.id === ref.audioSourceId)!
      expect(ref.sourceFingerprint).toEqual(source.fingerprint)
      expect(
        artifact.alignment.acousticEditUnits.every(
          (unit) => unit.sourceStart >= 0 && unit.sourceEnd <= source.metadata.durationSeconds,
        ),
      ).toBe(true)
    }
  },
)
