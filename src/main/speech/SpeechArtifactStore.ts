import { createHash, randomUUID } from 'crypto'
import { link, mkdir, readFile, rm, writeFile } from 'fs/promises'
import { dirname, resolve, sep } from 'path'
import {
  SpeechArtifactRefSchema,
  type SpeechArtifactRef,
} from '../../shared/project.types'
import {
  SpeechArtifactSchema,
  validateSpeechArtifactReference,
  type SpeechArtifact,
} from '../../shared/speechArtifact.schema'

export interface PreparedSpeechArtifact {
  artifact: SpeechArtifact
  bytes: Buffer
  reference: SpeechArtifactRef
}

export interface StagedSpeechArtifact extends PreparedSpeechArtifact {
  stagedPath: string
  finalPath: string
}

export class SpeechArtifactStore {
  constructor(private readonly projectRoot: string) {}

  prepare(input: SpeechArtifact): PreparedSpeechArtifact {
    const artifact = SpeechArtifactSchema.parse(input)
    const bytes = Buffer.from(`${stableStringify(artifact)}\n`, 'utf8')
    const artifactPath = `speech/${artifact.audioSourceId}/revision-${artifact.analysisRevisionId}.json`
    const reference = SpeechArtifactRefSchema.parse({
      audioSourceId: artifact.audioSourceId,
      analysisRevisionId: artifact.analysisRevisionId,
      sourceFingerprint: artifact.sourceFingerprint,
      artifactPath,
      artifactSha256: sha256(bytes),
      artifactByteLength: bytes.byteLength,
      artifactSchemaVersion: artifact.schemaVersion,
      summary: {
        transcriptUnitCount: artifact.transcript.units.length,
        acousticEditUnitCount: artifact.alignment.acousticEditUnits.length,
        speakerCount: artifact.speakers.length,
      },
    })
    return { artifact, bytes, reference }
  }

  async stage(prepared: PreparedSpeechArtifact): Promise<StagedSpeechArtifact> {
    const finalPath = this.resolveConfined(prepared.reference.artifactPath)
    const stagingDirectory = resolve(this.projectRoot, '.staging', 'speech')
    await mkdir(stagingDirectory, { recursive: true })
    const stagedPath = resolve(stagingDirectory, `${randomUUID()}.json`)
    await writeFile(stagedPath, prepared.bytes, { flag: 'wx' })
    return { ...prepared, stagedPath, finalPath }
  }

  async publish(staged: StagedSpeechArtifact): Promise<SpeechArtifactRef> {
    await mkdir(dirname(staged.finalPath), { recursive: true })
    try {
      await link(staged.stagedPath, staged.finalPath)
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'EEXIST')
        throw new Error(`Speech artifact already exists: ${staged.reference.artifactPath}`)
      throw error
    }
    await rm(staged.stagedPath, { force: true })
    return staged.reference
  }

  async discard(staged: Pick<StagedSpeechArtifact, 'stagedPath'>): Promise<void> {
    await rm(staged.stagedPath, { force: true })
  }

  async load(referenceInput: SpeechArtifactRef): Promise<SpeechArtifact> {
    const artifactPath = this.resolveConfined(referenceInput.artifactPath)
    const reference = SpeechArtifactRefSchema.parse(referenceInput)
    const bytes = await readFile(artifactPath)
    if (bytes.byteLength !== reference.artifactByteLength || sha256(bytes) !== reference.artifactSha256)
      throw new Error(`Speech artifact integrity check failed: ${reference.artifactPath}`)
    let decoded: unknown
    try {
      decoded = JSON.parse(bytes.toString('utf8'))
    } catch (cause) {
      throw new Error(`Speech artifact JSON is invalid: ${reference.artifactPath}`, { cause })
    }
    const artifact = SpeechArtifactSchema.parse(decoded)
    validateSpeechArtifactReference(reference, artifact)
    return artifact
  }

  private resolveConfined(relativePath: string): string {
    const speechRoot = resolve(this.projectRoot, 'speech')
    const candidate = resolve(this.projectRoot, relativePath)
    if (candidate !== speechRoot && !candidate.startsWith(`${speechRoot}${sep}`))
      throw new Error('Speech artifact path must be confined to project speech storage')
    return candidate
  }
}

function sha256(bytes: Buffer): string {
  return createHash('sha256').update(bytes).digest('hex')
}

function stableStringify(value: unknown): string {
  return JSON.stringify(sortKeys(value), null, 2)
}

function sortKeys(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortKeys)
  if (!value || typeof value !== 'object') return value
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, nested]) => [key, sortKeys(nested)]),
  )
}
