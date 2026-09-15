import { randomUUID } from 'crypto'
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
import { copyWithHash } from './copyWithHash'
import { fingerprintAudioFile, verifyAudioFingerprint } from './audioFingerprint'

import { nextTrackColor } from '../../../shared/trackColors'

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
      remove?: typeof rm
      copy?: typeof copyWithHash
    } = {
      builder: new FfmpegAudioSourceCacheBuilder(),
      probe: probeAudio,
      createId: randomUUID,
      availableBytes: async (path) => {
        const info = await statfs(path)
        return info.bavail * info.bsize
      },
      remove: rm,
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
      signal: AbortSignal,
    ) => Promise<CommitValue>,
    onProgress?: (progress: ImportProgress) => void,
  ): Promise<ImportResult<CommitValue>> {
    if (!AudioSourceIdSchema.safeParse(importId).success) throw new Error('Invalid import ID')
    if (this.active) throw new Error('Another audio import is already active')
    const admissionProject = ProjectFileSchema.parse(this.workspace.project)
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
    let result: ImportResult<CommitValue> | null = null
    let failure: unknown = null

    try {
      progress('validating', 0)
      const project = ProjectFileSchema.parse(projectInput)
      const metadata = AudioMetadataSchema.parse(
        await this.dependencies.probe(sourcePath, controller.signal),
      )
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
        copiedFingerprint = await (this.dependencies.copy ?? copyWithHash)(
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
        : await fingerprintAudioFile(durablePath, controller.signal)
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
      if (mode === 'reference')
        await verifyAudioFingerprint(durablePath, fingerprint, 'full', controller.signal)
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
        const latest = this.workspace.project
        committedProject = appendImportedSource(
          {
            ...latest,
            tracks:
              JSON.stringify(latest.tracks) === JSON.stringify(admissionProject.tracks)
                ? project.tracks
                : latest.tracks,
            export:
              JSON.stringify(latest.export) === JSON.stringify(admissionProject.export)
                ? project.export
                : latest.export,
          },
          source,
        )
        const committedValue = await commitProject(committedProject)
        active.state = 'committed'
        return committedValue
      }, controller.signal)
      const cache = new AudioSourceCacheStore(this.workspace.root).descriptor(manifest)
      progress('ready', 1)
      if (!committedProject) throw new Error('Import commit boundary did not publish a project')
      result = { project: committedProject, source, cache, value }
    } catch (error) {
      failure = error
      if (active.state !== 'committed') {
        active.state =
          controller.signal.aborted && error instanceof DOMException && error.name === 'AbortError'
            ? 'cancelled'
            : 'failed'
      }
    }
    const remove = this.dependencies.remove ?? rm
    const cleanupTargets = [
      ...(failure && active.state !== 'committed' && publishedMedia ? [finalMediaRoot] : []),
      ...(failure && active.state !== 'committed' && publishedCache ? [finalCacheRoot] : []),
      stageRoot,
    ]
    const cleanupErrors: unknown[] = []
    for (const target of cleanupTargets) {
      try {
        await remove(target, { recursive: true, force: true })
      } catch (error) {
        cleanupErrors.push(error)
      }
    }
    this.active = null
    if (cleanupErrors.length)
      throw new AggregateError(
        failure ? [failure, ...cleanupErrors] : cleanupErrors,
        'Import cleanup failed',
      )
    if (failure) throw failure
    if (!result) throw new Error('Import completed without a result')
    return result
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
        color: nextTrackColor(project.tracks.map((track) => track.color)),
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
