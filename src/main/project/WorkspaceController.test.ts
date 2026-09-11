import { createHash } from 'crypto'
import {
  mkdir,
  mkdtemp,
  readFile,
  realpath,
  rm,
  stat,
  symlink,
  utimes,
  writeFile,
} from 'fs/promises'
import { tmpdir } from 'os'
import { join } from 'path'
import { describe, expect, it, vi } from 'vitest'
import {
  createEmptyProject,
  ProjectFileSchema,
  type AudioSourceId,
} from '../../shared/project.types'
import type {
  ProjectDraft,
  ProjectMutationRequest,
  RendererSession,
  WorkspaceToken,
} from '../../shared/session.types'
import { AudioSourceCacheManifestSchema } from '../audio/cache/cacheManifest'
import type { FfmpegAudioSourceCacheBuilder } from '../audio/import/FfmpegAudioSourceCacheBuilder'
import { ProjectWorkspace } from './ProjectWorkspace'
import { WorkspaceController } from './WorkspaceController'

const SOURCE_ID = '00000000-0000-4000-8000-000000000001' as AudioSourceId

function deferred<T = void>() {
  let resolve!: (value: T | PromiseLike<T>) => void
  let reject!: (reason?: unknown) => void
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise
    reject = rejectPromise
  })
  return { promise, resolve, reject }
}

function request(
  session: RendererSession,
  draft: ProjectDraft = session.draft,
): ProjectMutationRequest {
  return { workspaceToken: session.workspaceToken, revision: session.revision, draft }
}

function draftWithLufs(session: RendererSession, targetLUFS: number): ProjectDraft {
  return { ...session.draft, export: { ...session.draft.export, targetLUFS } }
}

async function emptyPackage(parent: string, name: string): Promise<string> {
  const root = join(parent, name)
  await mkdir(root)
  await writeFile(join(root, 'project.json'), JSON.stringify(createEmptyProject(), null, 2))
  return root
}

async function packageWithoutCache() {
  const root = await mkdtemp(join(tmpdir(), 'podcut-open-'))
  const bytes = new Uint8Array([1, 2, 3, 4])
  await mkdir(join(root, 'media', SOURCE_ID), { recursive: true })
  await writeFile(join(root, 'media', SOURCE_ID, 'source.wav'), bytes)
  const project = ProjectFileSchema.parse({
    version: 2,
    createdAt: '2026-08-15T00:00:00.000Z',
    audioSettings: { processingSampleRate: 48_000 },
    audioSources: [
      {
        id: SOURCE_ID,
        displayName: 'source.wav',
        location: { mode: 'copy', path: `media/${SOURCE_ID}/source.wav` },
        fingerprint: {
          byteLength: bytes.byteLength,
          modifiedTimeMs: 1,
          sha256: createHash('sha256').update(bytes).digest('hex'),
        },
        metadata: {
          durationSeconds: 1,
          sampleRate: 48_000,
          channels: 1,
          codec: 'pcm_s16le',
          bitrateKbps: 768,
        },
      },
    ],
    tracks: [
      {
        id: 'track-1',
        name: 'Track 1',
        volume: 1,
        muted: false,
        solo: false,
        color: '#fff',
        effects: [],
        clips: [
          {
            id: 'clip-1',
            trackId: 'track-1',
            audioSourceId: SOURCE_ID,
            sourceStart: 0,
            sourceEnd: 1,
            outputStart: 0,
          },
        ],
      },
    ],
  })
  await writeFile(join(root, 'project.json'), JSON.stringify(project))
  return root
}

async function writeValidCache(root: string): Promise<void> {
  const request = {
    projectRoot: root,
    stagingRoot: join(root, '.staging', 'unused'),
    sourcePath: join(root, 'media', SOURCE_ID, 'source.wav'),
    audioSourceId: SOURCE_ID,
    sourceSha256: createHash('sha256')
      .update(new Uint8Array([1, 2, 3, 4]))
      .digest('hex'),
    metadata: {
      durationSeconds: 1,
      sampleRate: 48_000,
      channels: 1,
      codec: 'pcm_s16le',
      bitrateKbps: 768,
    },
    processingSampleRate: 48_000 as const,
  }
  const manifest = generatedManifest(request)
  await mkdir(join(root, 'cache', SOURCE_ID, 'waveform'), { recursive: true })
  await writeFile(join(root, manifest.pcm.file), new Uint8Array(manifest.pcm.byteLength))
  for (const level of manifest.waveform.levels)
    await writeFile(join(root, level.file), new Uint8Array(level.bucketCount * 8))
  await writeFile(
    join(root, 'cache', SOURCE_ID, 'manifest.json'),
    JSON.stringify(manifest, null, 2),
  )
}

function generatedManifest(request: Parameters<FfmpegAudioSourceCacheBuilder['build']>[0]) {
  const base = `cache/${request.audioSourceId}`
  return AudioSourceCacheManifestSchema.parse({
    version: 1,
    audioSourceId: request.audioSourceId,
    sourceSha256: request.sourceSha256,
    generatorVersion: 'podcut-cache-v1',
    pcm: {
      file: `${base}/audio.f32le`,
      sampleFormat: 'f32le',
      layout: 'interleaved',
      sampleRate: 48_000,
      channels: 1,
      frameCount: 48_000,
      byteLength: 192_000,
    },
    waveform: {
      representation: 'min-max-f32le',
      levels: [256, 4096, 65536].map((level) => ({
        file: `${base}/waveform/level-${level}.minmax-f32le`,
        samplesPerBucket: level,
        bucketCount: Math.ceil(48_000 / level),
      })),
    },
  })
}

describe('WorkspaceController session authority', () => {
  it('initializes revision one with an opaque token and returns the same current session', async () => {
    const controller = new WorkspaceController()
    const parent = await mkdtemp(join(tmpdir(), 'podcut-controller-'))

    const initialized = await controller.initialize(parent)
    const described = await controller.describe()

    expect(initialized.revision).toBe(1)
    expect(initialized.workspaceToken).toMatch(/^[0-9a-f-]{36}$/)
    expect(described).toEqual(initialized)
  })

  it('normal Save retains the token and advances the controller revision', async () => {
    const controller = new WorkspaceController()
    const session = await controller.initialize(await mkdtemp(join(tmpdir(), 'podcut-controller-')))

    const saved = await controller.save(request(session, draftWithLufs(session, -14)))

    expect(saved.workspaceToken).toBe(session.workspaceToken)
    expect(saved.revision).toBe(2)
    expect(saved.draft.export.targetLUFS).toBe(-14)
  })

  it('Save As rotates the token, advances the same revision, and deletes the old temporary root', async () => {
    const controller = new WorkspaceController()
    const parent = await mkdtemp(join(tmpdir(), 'podcut-controller-'))
    const session = await controller.initialize(parent)
    const oldRoot = controller.workspace.root
    const destination = join(parent, 'Saved.podcut')

    const saved = await controller.saveAs(destination, request(session))

    expect(saved.workspaceToken).not.toBe(session.workspaceToken)
    expect(saved.revision).toBe(2)
    expect(controller.workspace.root).toBe(destination)
    await expect(stat(oldRoot)).rejects.toMatchObject({ code: 'ENOENT' })
  })

  it('rejects stale tokens before mutation', async () => {
    const controller = new WorkspaceController()
    const session = await controller.initialize(await mkdtemp(join(tmpdir(), 'podcut-controller-')))

    await expect(
      controller.save({
        ...request(session),
        workspaceToken: 'stale-token' as WorkspaceToken,
      }),
    ).rejects.toThrow('Stale workspace token')
    expect((await controller.describe()).revision).toBe(1)
  })

  it('rejects stale revisions before mutation', async () => {
    const controller = new WorkspaceController()
    const session = await controller.initialize(await mkdtemp(join(tmpdir(), 'podcut-controller-')))

    await expect(controller.save({ ...request(session), revision: 0 })).rejects.toThrow(
      'Stale workspace revision',
    )
    expect((await controller.describe()).revision).toBe(1)
  })

  it('leaves token and revision unchanged when a project write fails', async () => {
    const controller = new WorkspaceController()
    const session = await controller.initialize(await mkdtemp(join(tmpdir(), 'podcut-controller-')))
    vi.spyOn(ProjectWorkspace.prototype, 'save').mockRejectedValueOnce(new Error('disk full'))

    await expect(controller.save(request(session, draftWithLufs(session, -12)))).rejects.toThrow(
      'disk full',
    )

    const current = await controller.describe()
    expect(current.workspaceToken).toBe(session.workspaceToken)
    expect(current.revision).toBe(session.revision)
    expect(current.draft.export.targetLUFS).toBe(session.draft.export.targetLUFS)
  })

  it('switches only after a prepared candidate validates and preserves current on failure', async () => {
    const buildEntered = deferred()
    const failBuild = deferred()
    const controller = new WorkspaceController({
      build: vi.fn(async () => {
        buildEntered.resolve()
        return failBuild.promise
      }),
    } as unknown as FfmpegAudioSourceCacheBuilder)
    const session = await controller.initialize(await mkdtemp(join(tmpdir(), 'podcut-controller-')))
    const oldRoot = controller.workspace.root
    const preparation = controller.prepareOpen(await packageWithoutCache())
    await buildEntered.promise

    expect(controller.workspace.root).toBe(oldRoot)
    failBuild.reject(new Error('decode failed'))
    await expect(preparation).rejects.toThrow('decode failed')
    expect(controller.workspace.root).toBe(oldRoot)
    expect(await stat(oldRoot)).toBeTruthy()
    expect(await controller.describe()).toMatchObject({
      workspaceToken: session.workspaceToken,
      revision: session.revision,
    })
  })

  it('never deletes an old saved package after a successful switch', async () => {
    const controller = new WorkspaceController()
    const parent = await mkdtemp(join(tmpdir(), 'podcut-controller-'))
    const initial = await controller.initialize(parent)
    const firstRoot = join(parent, 'First.podcut')
    const first = await controller.saveAs(firstRoot, request(initial))
    const candidate = await controller.prepareOpen(await emptyPackage(parent, 'Second.podcut'))

    const second = await controller.commitPreparedOpen(candidate, first)

    expect(second.revision).toBe(3)
    expect(second.workspaceToken).not.toBe(first.workspaceToken)
    expect(await readFile(join(firstRoot, 'project.json'), 'utf8')).toContain('"version": 2')
  })

  it('rejects Open through a symlink to the same temporary root without changing the session', async () => {
    const controller = new WorkspaceController()
    const parent = await mkdtemp(join(tmpdir(), 'podcut-controller-'))
    const session = await controller.initialize(parent)
    const temporaryRoot = controller.workspace.root
    const alias = join(parent, 'Alias.podcut')
    await symlink(temporaryRoot, alias, 'dir')
    const candidate = await controller.prepareOpen(alias)

    await expect(controller.commitPreparedOpen(candidate, session)).rejects.toThrow(
      'overlaps the temporary workspace',
    )

    expect(controller.workspace.root).toBe(temporaryRoot)
    expect(() => controller.assertCurrent(session)).not.toThrow()
    expect(await readFile(join(temporaryRoot, 'project.json'), 'utf8')).toContain('"version": 2')
  })

  it('rejects an Open alias lexically below the temporary root even when it targets an external project', async () => {
    const controller = new WorkspaceController()
    const parent = await mkdtemp(join(tmpdir(), 'podcut-controller-'))
    const session = await controller.initialize(parent)
    const temporaryRoot = controller.workspace.root
    const externalRoot = await emptyPackage(parent, 'External.podcut')
    const alias = join(temporaryRoot, 'ExternalAlias.podcut')
    await symlink(externalRoot, alias, 'dir')
    const candidate = await controller.prepareOpen(alias)

    const outcome = await controller
      .commitPreparedOpen(candidate, session)
      .then(() => ({ status: 'installed' as const }))
      .catch((error: unknown) => ({
        status: 'rejected' as const,
        message: error instanceof Error ? error.message : 'non-error rejection',
      }))
    const aliasExists = await stat(alias).then(
      () => true,
      () => false,
    )
    let originalSessionIsCurrent = true
    try {
      controller.assertCurrent(session)
    } catch {
      originalSessionIsCurrent = false
    }

    expect({
      outcome,
      aliasExists,
      currentRoot: controller.workspace.root,
      originalSessionIsCurrent,
    }).toEqual({
      outcome: {
        status: 'rejected',
        message: 'Candidate root overlaps the temporary workspace',
      },
      aliasExists: true,
      currentRoot: temporaryRoot,
      originalSessionIsCurrent: true,
    })
  })

  it('rejects Open of a descendant of the temporary root without changing the session', async () => {
    const controller = new WorkspaceController()
    const parent = await mkdtemp(join(tmpdir(), 'podcut-controller-'))
    const session = await controller.initialize(parent)
    const temporaryRoot = controller.workspace.root
    const candidate = await controller.prepareOpen(
      await emptyPackage(temporaryRoot, 'Nested.podcut'),
    )

    await expect(controller.commitPreparedOpen(candidate, session)).rejects.toThrow(
      'overlaps the temporary workspace',
    )

    expect(controller.workspace.root).toBe(temporaryRoot)
    expect(() => controller.assertCurrent(session)).not.toThrow()
    expect(await readFile(join(temporaryRoot, 'project.json'), 'utf8')).toContain('"version": 2')
  })

  it('rejects Save As through a symlink to the same temporary root before publication', async () => {
    const controller = new WorkspaceController()
    const parent = await mkdtemp(join(tmpdir(), 'podcut-controller-'))
    const session = await controller.initialize(parent)
    const temporaryRoot = controller.workspace.root
    const alias = join(parent, 'Alias.podcut')
    await symlink(temporaryRoot, alias, 'dir')

    await expect(controller.saveAs(alias, request(session))).rejects.toThrow(
      'overlaps the temporary workspace',
    )

    expect(controller.workspace.root).toBe(temporaryRoot)
    expect(() => controller.assertCurrent(session)).not.toThrow()
    expect(await readFile(join(temporaryRoot, 'project.json'), 'utf8')).toContain('"version": 2')
  })

  it('rejects Save As below the temporary root before publication', async () => {
    const controller = new WorkspaceController()
    const parent = await mkdtemp(join(tmpdir(), 'podcut-controller-'))
    const session = await controller.initialize(parent)
    const temporaryRoot = controller.workspace.root
    const destination = join(temporaryRoot, 'Nested.podcut')

    await expect(controller.saveAs(destination, request(session))).rejects.toThrow(
      'overlaps the temporary workspace',
    )

    expect(controller.workspace.root).toBe(temporaryRoot)
    expect(() => controller.assertCurrent(session)).not.toThrow()
    await expect(stat(destination)).rejects.toMatchObject({ code: 'ENOENT' })
  })

  it('keeps a captured original resolver bound to its validated workspace after a switch', async () => {
    const controller = new WorkspaceController()
    const parent = await mkdtemp(join(tmpdir(), 'podcut-controller-'))
    await controller.initialize(parent)
    const firstRoot = await packageWithoutCache()
    const secondRoot = await packageWithoutCache()
    await Promise.all([writeValidCache(firstRoot), writeValidCache(secondRoot)])
    const first = await controller.open(firstRoot)
    const resolveCapturedOriginal = controller.captureOriginalResolver(first)

    await controller.open(secondRoot)

    await expect(resolveCapturedOriginal(SOURCE_ID)).resolves.toBe(
      join(await realpath(firstRoot), 'media', SOURCE_ID, 'source.wav'),
    )
  })
})

describe('WorkspaceController serialization', () => {
  it('keeps Open queued while Save is paused in descriptor validation', async () => {
    const validationEntered = deferred()
    const releaseValidation = deferred()
    const controller = new WorkspaceController({
      build: vi.fn(async (cacheRequest: Parameters<FfmpegAudioSourceCacheBuilder['build']>[0]) => {
        validationEntered.resolve()
        await releaseValidation.promise
        return generatedManifest(cacheRequest)
      }),
    } as unknown as FfmpegAudioSourceCacheBuilder)
    const parent = await mkdtemp(join(tmpdir(), 'podcut-controller-'))
    await controller.initialize(parent)
    const activeRoot = await packageWithoutCache()
    await writeValidCache(activeRoot)
    const session = await controller.open(activeRoot)
    const candidate = await controller.prepareOpen(await emptyPackage(parent, 'Candidate.podcut'))
    await rm(join(activeRoot, 'cache', SOURCE_ID, 'manifest.json'))

    const saving = controller.save(request(session, draftWithLufs(session, -13)))
    await validationEntered.promise
    const opening = controller.commitPreparedOpen(candidate, session)
    await Promise.resolve()
    expect(controller.workspace.root).toBe(activeRoot)

    releaseValidation.resolve()
    await expect(saving).resolves.toMatchObject({ revision: session.revision + 1 })
    await expect(opening).rejects.toThrow('Stale workspace revision')
    expect(controller.workspace.root).toBe(activeRoot)
  })

  it('keeps a concurrent Open commit queued while Save writes its captured workspace', async () => {
    const controller = new WorkspaceController()
    const parent = await mkdtemp(join(tmpdir(), 'podcut-controller-'))
    const session = await controller.initialize(parent)
    const oldRoot = controller.workspace.root
    const candidate = await controller.prepareOpen(await emptyPackage(parent, 'Candidate.podcut'))
    const writeEntered = deferred()
    const releaseWrite = deferred()
    const actualSave = ProjectWorkspace.prototype.save
    vi.spyOn(ProjectWorkspace.prototype, 'save').mockImplementationOnce(async function (
      this: ProjectWorkspace,
      project,
    ) {
      writeEntered.resolve()
      await releaseWrite.promise
      return actualSave.call(this, project)
    })

    const saving = controller.save(request(session, draftWithLufs(session, -13)))
    await writeEntered.promise
    const opening = controller.commitPreparedOpen(candidate, session)
    await Promise.resolve()
    expect(controller.workspace.root).toBe(oldRoot)

    releaseWrite.resolve()
    const saved = await saving
    await expect(opening).rejects.toThrow('Stale workspace revision')
    expect(controller.workspace.root).toBe(oldRoot)
    expect(saved.revision).toBe(2)
    expect(
      JSON.parse(await readFile(join(oldRoot, 'project.json'), 'utf8')).export.targetLUFS,
    ).toBe(-13)
  })

  it('queues concurrent Save behind Save As and rejects its now-stale precondition', async () => {
    const controller = new WorkspaceController()
    const parent = await mkdtemp(join(tmpdir(), 'podcut-controller-'))
    const session = await controller.initialize(parent)
    const destination = join(parent, 'Saved.podcut')
    const publishEntered = deferred()
    const releasePublish = deferred()
    const actualSaveAs = ProjectWorkspace.prototype.saveAs
    vi.spyOn(ProjectWorkspace.prototype, 'saveAs').mockImplementationOnce(async function (
      this: ProjectWorkspace,
      ...args
    ) {
      publishEntered.resolve()
      await releasePublish.promise
      return actualSaveAs.apply(this, args)
    })

    const saveAs = controller.saveAs(destination, request(session, draftWithLufs(session, -13)))
    await publishEntered.promise
    const queuedSave = controller.save(request(session, draftWithLufs(session, -12)))
    await Promise.resolve()
    expect(controller.workspace.root).not.toBe(destination)

    releasePublish.resolve()
    const switched = await saveAs
    await expect(queuedSave).rejects.toThrow('Stale workspace token')
    expect(switched.revision).toBe(2)
    expect(switched.draft.export.targetLUFS).toBe(-13)
  })

  it('serializes import commit at one publish boundary and advances revision once', async () => {
    const controller = new WorkspaceController()
    const parent = await mkdtemp(join(tmpdir(), 'podcut-controller-'))
    const session = await controller.initialize(parent)
    const writeEntered = deferred()
    const releaseWrite = deferred()
    const actualSave = ProjectWorkspace.prototype.save
    vi.spyOn(ProjectWorkspace.prototype, 'save').mockImplementationOnce(async function (
      this: ProjectWorkspace,
      project,
    ) {
      writeEntered.resolve()
      await releaseWrite.promise
      return actualSave.call(this, project)
    })
    const importedProject = ProjectFileSchema.parse({
      ...controller.workspace.project,
      pluginData: { imported: true },
    })

    const committing = controller.runTransition(session, (transaction) =>
      transaction.commitImport(importedProject),
    )
    await writeEntered.promise
    const queuedSave = controller.save(request(session))
    releaseWrite.resolve()

    const committed = await committing
    await expect(queuedSave).rejects.toThrow('Stale workspace revision')
    expect(committed.workspaceToken).toBe(session.workspaceToken)
    expect(committed.revision).toBe(2)
    expect(controller.workspace.project.pluginData).toEqual({ imported: true })
  })

  it('removes an aborted queued transition before it can enter the workspace', async () => {
    const controller = new WorkspaceController()
    const parent = await mkdtemp(join(tmpdir(), 'podcut-controller-'))
    const session = await controller.initialize(parent)
    const firstEntered = deferred()
    const releaseFirst = deferred()
    const events: string[] = []
    const first = controller.runTransition(session, async (transaction) => {
      events.push('first')
      firstEntered.resolve()
      await releaseFirst.promise
      return transaction.describe()
    })
    await firstEntered.promise
    const abortController = new AbortController()
    const aborted = controller.runTransition(
      session,
      (transaction) => {
        events.push('aborted')
        return transaction.describe()
      },
      abortController.signal,
    )
    const third = controller.runTransition(session, (transaction) => {
      events.push('third')
      return transaction.describe()
    })

    abortController.abort()
    await expect(aborted).rejects.toMatchObject({ name: 'AbortError' })
    releaseFirst.resolve()
    await Promise.all([first, third])
    expect(events).toEqual(['first', 'third'])
  })

  it('holds one lock across dirty Save, candidate preparation, and switch without deadlock', async () => {
    const controller = new WorkspaceController()
    const parent = await mkdtemp(join(tmpdir(), 'podcut-controller-'))
    const initialized = await controller.initialize(parent)
    const session = await controller.saveAs(join(parent, 'Current.podcut'), request(initialized))
    const oldRoot = controller.workspace.root
    const candidateRoot = await emptyPackage(parent, 'Candidate.podcut')
    const savedInsideTransition = deferred<RendererSession>()
    const continueTransition = deferred()

    const switching = controller.runTransition(session, async (transaction) => {
      const saved = await transaction.save(draftWithLufs(session, -13))
      savedInsideTransition.resolve(saved)
      await continueTransition.promise
      const candidate = await transaction.prepareOpen(candidateRoot)
      return transaction.commitPreparedOpen(candidate)
    })
    const saved = await savedInsideTransition.promise
    const queuedSave = controller.save(request(saved, draftWithLufs(saved, -12)))
    await Promise.resolve()
    expect(controller.workspace.root).toBe(oldRoot)

    continueTransition.resolve()
    const switched = await switching
    await expect(queuedSave).rejects.toThrow('Stale workspace token')
    expect(switched.revision).toBe(session.revision + 2)
    expect(controller.workspace.root).toBe(candidateRoot)
    expect(
      JSON.parse(await readFile(join(oldRoot, 'project.json'), 'utf8')).export.targetLUFS,
    ).toBe(-13)
  })
})

describe('WorkspaceController cache recovery', () => {
  it('regenerates a missing cache before publishing a newly opened workspace', async () => {
    const build = vi.fn(async (request: Parameters<FfmpegAudioSourceCacheBuilder['build']>[0]) =>
      generatedManifest(request),
    )
    const controller = new WorkspaceController({
      build,
    } as unknown as FfmpegAudioSourceCacheBuilder)
    const session = await controller.initialize(await mkdtemp(join(tmpdir(), 'podcut-controller-')))
    const result = await controller.open(await packageWithoutCache())
    expect(build).toHaveBeenCalledTimes(1)
    expect(result.sources[0]).toMatchObject({ id: SOURCE_ID, metadata: { sampleRate: 48_000 } })
    expect(result.revision).toBe(session.revision + 1)
  })

  it('keeps the previous workspace active when cache regeneration fails', async () => {
    const controller = new WorkspaceController({
      build: vi.fn(async () => {
        throw new Error('decode failed')
      }),
    } as unknown as FfmpegAudioSourceCacheBuilder)
    await controller.initialize(await mkdtemp(join(tmpdir(), 'podcut-controller-')))
    const previousRoot = controller.workspace.root
    await expect(controller.open(await packageWithoutCache())).rejects.toThrow('decode failed')
    expect(controller.workspace.root).toBe(previousRoot)
  })

  it('rejects a package whose original is missing even when its cache is valid', async () => {
    const controller = new WorkspaceController({
      build: vi.fn(),
    } as unknown as FfmpegAudioSourceCacheBuilder)
    await controller.initialize(await mkdtemp(join(tmpdir(), 'podcut-controller-')))
    const previousRoot = controller.workspace.root
    const candidate = await packageWithoutCache()
    await writeValidCache(candidate)
    await rm(join(candidate, 'media', SOURCE_ID, 'source.wav'))
    await expect(controller.open(candidate)).rejects.toThrow('Original audio is unavailable')
    expect(controller.workspace.root).toBe(previousRoot)
  })

  it('validates originals before a normal save can commit project edits', async () => {
    const controller = new WorkspaceController({
      build: vi.fn(),
    } as unknown as FfmpegAudioSourceCacheBuilder)
    const root = await packageWithoutCache()
    await writeValidCache(root)
    await controller.initialize(await mkdtemp(join(tmpdir(), 'podcut-controller-')))
    const session = await controller.open(root)
    await rm(join(root, 'media', SOURCE_ID, 'source.wav'))
    await expect(controller.save(request(session, draftWithLufs(session, -10)))).rejects.toThrow(
      'Original audio is unavailable',
    )
    const persisted = JSON.parse(await readFile(join(root, 'project.json'), 'utf8'))
    expect(persisted.export.targetLUFS).toBe(session.draft.export.targetLUFS)
    expect(() => controller.assertCurrent(session)).not.toThrow()
  })

  it('hashes and rejects same-length changed bytes when quick-save metadata differs', async () => {
    const controller = new WorkspaceController({
      build: vi.fn(),
    } as unknown as FfmpegAudioSourceCacheBuilder)
    const root = await packageWithoutCache()
    await writeValidCache(root)
    await controller.initialize(await mkdtemp(join(tmpdir(), 'podcut-controller-')))
    const session = await controller.open(root)
    await writeFile(join(root, 'media', SOURCE_ID, 'source.wav'), new Uint8Array([4, 3, 2, 1]))

    await expect(controller.save(request(session, draftWithLufs(session, -10)))).rejects.toThrow(
      'Original audio changed since import',
    )

    const persisted = JSON.parse(await readFile(join(root, 'project.json'), 'utf8'))
    expect(persisted.export.targetLUFS).toBe(session.draft.export.targetLUFS)
    expect(() => controller.assertCurrent(session)).not.toThrow()
  })

  it('accepts a metadata-only timestamp change after quick validation falls back to the hash', async () => {
    const builder = { build: vi.fn() } as unknown as FfmpegAudioSourceCacheBuilder
    const controller = new WorkspaceController(builder)
    const root = await packageWithoutCache()
    await writeValidCache(root)
    await controller.initialize(await mkdtemp(join(tmpdir(), 'podcut-controller-')))
    const session = await controller.open(root)
    const sourcePath = join(root, 'media', SOURCE_ID, 'source.wav')
    const touched = new Date(Date.now() + 10_000)
    await utimes(sourcePath, touched, touched)

    await expect(
      controller.save(request(session, draftWithLufs(session, -10))),
    ).resolves.toMatchObject({
      workspaceToken: session.workspaceToken,
      revision: session.revision + 1,
    })
    expect(builder.build).not.toHaveBeenCalled()
  })
})

it('resolves speech PCM only from the captured source cache and rejects stale or damaged inputs', async () => {
  const root = await packageWithoutCache()
  try {
    await writeValidCache(root)
    const controller = new WorkspaceController()
    await controller.initialize(root)
    const session = await controller.open(root)
    const resolveSpeech = controller.captureSpeechPcmResolver(session)
    expect(await resolveSpeech(SOURCE_ID)).toEqual({
      path: await realpath(join(root, 'cache', SOURCE_ID, 'audio.f32le')),
      sampleRate: 48000,
      channels: 1,
    })
    expect(() =>
      controller.captureSpeechPcmResolver({ ...session, revision: session.revision + 1 }),
    ).toThrow('Stale workspace revision')
    await expect(resolveSpeech('unknown' as AudioSourceId)).rejects.toThrow('Unknown audio source')
    await writeFile(join(root, 'cache', SOURCE_ID, 'audio.f32le'), Buffer.alloc(4))
    await expect(resolveSpeech(SOURCE_ID)).rejects.toThrow('Speech audio cache is invalid')
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})
