import { createHash, randomUUID } from 'crypto'
import { once } from 'events'
import { createReadStream, createWriteStream } from 'fs'
import { mkdir, rename, rm, stat, statfs } from 'fs/promises'
import { basename, extname, join } from 'path'
import type {
  ImportCancellationResult,
  ImportJobState,
  ImportMode,
  ImportProgress,
  ImportResult,
} from '../../../shared/import.types'
import {
  AudioSourceIdSchema,
  AudioMetadataSchema,
  ProjectFileSchema,
  type AudioMetadata,
  type AudioSource,
  type ProjectFile,
  type ProjectRelativePath,
} from '../../../shared/project.types'
import type { ProjectWorkspace } from '../../project/ProjectWorkspace'
import { probeAudio } from './probeAudio'
import { AudioSourceCacheStore } from '../cache/AudioSourceCacheStore'
import { FfmpegAudioSourceCacheBuilder } from './FfmpegAudioSourceCacheBuilder'

const TRACK_COLORS = ['#6366f1', '#10b981', '#f59e0b', '#ec4899', '#3b82f6']

export class ImportCoordinator {
  private active: {
    id: string
    controller: AbortController
    state: ImportJobState
  } | null = null

  constructor(
    private readonly workspace: ProjectWorkspace,
    private readonly dependencies: {
      builder: Pick<FfmpegAudioSourceCacheBuilder, 'build'>
      probe: typeof probeAudio
      createId: () => string
      availableBytes: (path: string) => Promise<number>
    } = {
      builder: new FfmpegAudioSourceCacheBuilder(),
      probe: probeAudio,
      createId: randomUUID,
      availableBytes: async (path) => {
        const info = await statfs(path)
        return info.bavail * info.bsize
      },
    },
  ) {}

  cancel(importId: string): ImportCancellationResult {
    const active = this.active
    if (!active || active.id !== importId) return 'not-found'
    if (active.state === 'committing' || active.state === 'committed') return 'commit-won'
    if (active.state === 'cancelled') return 'cancelled'
    if (active.state !== 'preparing') return 'not-found'
    active.state = 'cancelled'
    active.controller.abort()
    return 'cancelled'
  }

  async import<CommitValue>(
    importId: string,
    sourcePath: string,
    mode: ImportMode,
    projectInput: ProjectFile,
    runCommitBoundary: (
      operation: (
        commitProject: (project: ProjectFile) => Promise<CommitValue>,
      ) => Promise<CommitValue>,
    ) => Promise<CommitValue>,
    onProgress?: (progress: ImportProgress) => void,
  ): Promise<ImportResult<CommitValue>> {
    if (!AudioSourceIdSchema.safeParse(importId).success) throw new Error('Invalid import ID')
    if (this.active) throw new Error('Another audio import is already active')
    const controller = new AbortController()
    const active = { id: importId, controller, state: 'preparing' as ImportJobState }
    this.active = active
    const displayName = basename(sourcePath)
    const progress = (stage: ImportProgress['stage'], percent: number) => {
      try {
        onProgress?.({ importId, displayName, stage, percent })
      } catch {
        // Progress is advisory and cannot reverse a committed import.
      }
    }
    const id = AudioSourceIdSchema.parse(this.dependencies.createId())
    const stageRoot = join(this.workspace.root, '.staging', randomUUID())
    const finalMediaRoot = join(this.workspace.root, 'media', id)
    const finalCacheRoot = join(this.workspace.root, 'cache', id)
    let publishedMedia = false
    let publishedCache = false

    try {
      progress('validating', 0)
      const project = ProjectFileSchema.parse(projectInput)
      const metadata = AudioMetadataSchema.parse(await this.dependencies.probe(sourcePath))
      if (metadata.durationSeconds <= 0)
        throw new Error(`Audio duration is unavailable for ${displayName}`)
      const sourceInfo = await stat(sourcePath)
      const requiredBytes = estimateImportBytes(sourceInfo.size, metadata, mode)
      if ((await this.dependencies.availableBytes(this.workspace.root)) < requiredBytes) {
        throw new Error(`Not enough disk space to import ${displayName}`)
      }
      this.throwIfAborted(controller.signal)
      await mkdir(stageRoot, { recursive: true })

      let durablePath = sourcePath
      let copiedFingerprint: { byteLength: number; sha256: string } | null = null
      let location: AudioSource['location']
      if (mode === 'copy') {
        progress('copying', 0)
        const stageMediaRoot = join(stageRoot, 'media', id)
        await mkdir(stageMediaRoot, { recursive: true })
        durablePath = join(stageMediaRoot, safeMediaName(displayName))
        copiedFingerprint = await copyWithHash(
          sourcePath,
          durablePath,
          controller.signal,
          (byteLength) => progress('copying', sourceInfo.size ? byteLength / sourceInfo.size : 1),
        )
        location = {
          mode: 'copy',
          path: `media/${id}/${safeMediaName(displayName)}` as ProjectRelativePath,
        }
      } else {
        progress('referencing', 0)
        location = { mode: 'reference', path: sourcePath }
      }

      const fingerprint = copiedFingerprint
        ? {
            ...copiedFingerprint,
            modifiedTimeMs: (await stat(durablePath)).mtimeMs,
          }
        : await fingerprintFile(durablePath, controller.signal)
      const source: AudioSource = { id, displayName, location, fingerprint, metadata }
      progress('building-cache', 0)
      const manifest = await this.dependencies.builder.build(
        {
          projectRoot: stageRoot,
          stagingRoot: join(stageRoot, 'cache-stage'),
          sourcePath: durablePath,
          audioSourceId: id,
          sourceSha256: fingerprint.sha256,
          metadata,
          processingSampleRate: 48_000,
        },
        controller.signal,
        (value) => progress('building-cache', value),
      )
      this.throwIfAborted(controller.signal)
      let committedProject: ProjectFile | null = null
      const value = await runCommitBoundary(async (commitProject) => {
        this.throwIfAborted(controller.signal)
        active.state = 'committing'
        progress('publishing', 0.99)
        await mkdir(join(this.workspace.root, 'cache'), { recursive: true })
        await rename(join(stageRoot, 'cache', id), finalCacheRoot)
        publishedCache = true
        if (mode === 'copy') {
          await mkdir(join(this.workspace.root, 'media'), { recursive: true })
          await rename(join(stageRoot, 'media', id), finalMediaRoot)
          publishedMedia = true
          durablePath = join(finalMediaRoot, safeMediaName(displayName))
          source.fingerprint.modifiedTimeMs = (await stat(durablePath)).mtimeMs
        }
        committedProject = appendImportedSource(project, source)
        const committedValue = await commitProject(committedProject)
        active.state = 'committed'
        return committedValue
      })
      const cache = new AudioSourceCacheStore(this.workspace.root).descriptor(manifest)
      progress('ready', 1)
      if (!committedProject) throw new Error('Import commit boundary did not publish a project')
      return { project: committedProject, source, cache, value }
    } catch (error) {
      if (active.state !== 'committed') {
        active.state =
          controller.signal.aborted && error instanceof DOMException && error.name === 'AbortError'
            ? 'cancelled'
            : 'failed'
        if (publishedMedia)
          await rm(finalMediaRoot, { recursive: true, force: true }).catch(() => {})
        if (publishedCache)
          await rm(finalCacheRoot, { recursive: true, force: true }).catch(() => {})
      }
      throw error
    } finally {
      await rm(stageRoot, { recursive: true, force: true }).catch(() => {})
      this.active = null
    }
  }

  private throwIfAborted(signal: AbortSignal): void {
    if (signal.aborted) throw new DOMException('Import aborted', 'AbortError')
  }
}

function appendImportedSource(project: ProjectFile, source: AudioSource): ProjectFile {
  const trackId = randomUUID()
  return ProjectFileSchema.parse({
    ...project,
    audioSources: [...project.audioSources, source],
    tracks: [
      ...project.tracks,
      {
        id: trackId,
        name: `Track ${project.tracks.length + 1}`,
        color: TRACK_COLORS[project.tracks.length % TRACK_COLORS.length],
        clips: [
          {
            id: randomUUID(),
            trackId,
            audioSourceId: source.id,
            sourceStart: 0,
            sourceEnd: source.metadata.durationSeconds,
            outputStart: 0,
          },
        ],
      },
    ],
  })
}

function safeMediaName(name: string): string {
  const extension = extname(name)
  const stem = basename(name, extension).replace(/[^A-Za-z0-9._-]+/g, '_') || 'audio'
  return `${stem}${extension.toLowerCase()}`
}

async function copyWithHash(
  source: string,
  destination: string,
  signal: AbortSignal,
  onBytes?: (byteLength: number) => void,
): Promise<{ byteLength: number; sha256: string }> {
  const input = createReadStream(source)
  const output = createWriteStream(destination, { flags: 'wx' })
  const hash = createHash('sha256')
  let byteLength = 0
  const abort = () => {
    input.destroy(new DOMException('Import aborted', 'AbortError'))
    output.destroy()
  }
  signal.addEventListener('abort', abort, { once: true })
  try {
    for await (const chunk of input) {
      hash.update(chunk as Buffer)
      byteLength += (chunk as Buffer).byteLength
      onBytes?.(byteLength)
      if (!output.write(chunk)) await once(output, 'drain')
    }
    output.end()
    await once(output, 'close')
    return { byteLength, sha256: hash.digest('hex') }
  } catch (error) {
    input.destroy()
    output.destroy()
    throw error
  } finally {
    signal.removeEventListener('abort', abort)
  }
}

function estimateImportBytes(
  sourceBytes: number,
  metadata: AudioMetadata,
  mode: ImportMode,
): number {
  const frames = Math.ceil(metadata.durationSeconds * 48_000)
  const pcmBytes = frames * metadata.channels * 4
  const waveformBytes = [256, 4096, 65536].reduce(
    (total, level) => total + Math.ceil(frames / level) * 8,
    0,
  )
  const copiedBytes = mode === 'copy' ? sourceBytes : 0
  return Math.ceil((copiedBytes + pcmBytes + waveformBytes) * 1.1)
}

async function fingerprintFile(
  path: string,
  signal: AbortSignal,
): Promise<AudioSource['fingerprint']> {
  const hash = createHash('sha256')
  for await (const chunk of createReadStream(path)) {
    if (signal.aborted) throw new DOMException('Import aborted', 'AbortError')
    hash.update(chunk as Buffer)
  }
  const info = await stat(path)
  return { byteLength: info.size, modifiedTimeMs: info.mtimeMs, sha256: hash.digest('hex') }
}
