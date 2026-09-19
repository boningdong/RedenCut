import { mkdir, mkdtemp, readFile, readdir, rm, stat, writeFile } from 'fs/promises'
import { tmpdir } from 'os'
import { join } from 'path'
import { describe, expect, it, vi } from 'vitest'
import { ProjectFileSchema } from '../../shared/ProjectTypes'
import { ProjectWorkspace } from './ProjectWorkspace'

describe('ProjectWorkspace', () => {
  it('create-only publication preserves a destination that appears during staging', async () => {
    const parent = await mkdtemp(join(tmpdir(), 'redencut-create-only-'))
    try {
      const workspace = await ProjectWorkspace.initialize(parent, { saveAsPolicy: 'create' })
      const destination = join(parent, 'new.redencut')
      await expect(
        workspace.saveAs(destination, workspace.project, async () => {
          await mkdir(destination)
          await writeFile(join(destination, 'owner.txt'), 'not ours')
        }),
      ).rejects.toMatchObject({ code: 'EEXIST' })
      expect(await readFile(join(destination, 'owner.txt'), 'utf8')).toBe('not ours')
      expect((await readdir(parent)).some((name) => name.endsWith('.staging'))).toBe(false)
    } finally {
      await rm(parent, { recursive: true, force: true })
    }
  })
  it('initializes a temporary managed bundle with a valid empty project', async () => {
    const parent = await mkdtemp(join(tmpdir(), 'redencut-workspaces-'))
    const workspace = await ProjectWorkspace.initialize(parent)
    const project = ProjectFileSchema.parse(
      JSON.parse(await readFile(join(workspace.root, 'project.json'), 'utf8')),
    )

    expect(workspace.descriptor.kind).toBe('temporary')
    expect(project.audioSources).toEqual([])
    expect(project.audioSettings.processingSampleRate).toBe(48_000)
  })

  it('writes project.json atomically without changing the workspace root', async () => {
    const parent = await mkdtemp(join(tmpdir(), 'redencut-workspaces-'))
    const workspace = await ProjectWorkspace.initialize(parent)
    const root = workspace.root
    const project = workspace.project
    project.pluginData = { saved: true }

    await workspace.save(project)

    expect(workspace.root).toBe(root)
    expect(JSON.parse(await readFile(join(root, 'project.json'), 'utf8')).pluginData).toEqual({
      saved: true,
    })
  })

  it('publishes Save As through a validated sibling and replaces an existing destination', async () => {
    const parent = await mkdtemp(join(tmpdir(), 'redencut-workspaces-'))
    const warningSink = { record: vi.fn() }
    const workspace = await ProjectWorkspace.initialize(parent, { cleanupWarningSink: warningSink })
    const sourceId = '00000000-0000-4000-8000-000000000001'
    await mkdir(join(workspace.root, 'media', sourceId), { recursive: true })
    await writeFile(join(workspace.root, 'media', sourceId, 'kept.wav'), 'managed artifact')
    await mkdir(join(workspace.root, 'cache', 'orphan'), { recursive: true })
    await writeFile(join(workspace.root, 'cache', 'orphan', 'partial.bin'), 'crash leftover')
    const destination = join(parent, 'Episode.redencut')
    await mkdir(destination)
    await writeFile(join(destination, 'old.txt'), 'old destination')
    const project = ProjectFileSchema.parse({
      ...workspace.project,
      pluginData: { savedAs: true },
      audioSources: [
        {
          id: sourceId,
          displayName: 'kept.wav',
          location: { mode: 'copy', path: `media/${sourceId}/kept.wav` },
          fingerprint: { byteLength: 16, modifiedTimeMs: 1, sha256: 'a'.repeat(64) },
          metadata: {
            durationSeconds: 1,
            sampleRate: 48_000,
            channels: 1,
            codec: 'pcm_s16le',
            bitrateKbps: 768,
          },
        },
      ],
    })

    const saved = await workspace.saveAs(destination, project)

    expect(workspace.root).not.toBe(destination)
    expect(workspace.descriptor.kind).toBe('temporary')
    expect(saved.root).toBe(destination)
    expect(saved.descriptor.kind).toBe('saved')
    expect(saved.project.pluginData).toEqual({ savedAs: true })
    expect(await readFile(join(destination, 'media', sourceId, 'kept.wav'), 'utf8')).toBe(
      'managed artifact',
    )
    await expect(stat(join(destination, 'cache', 'orphan'))).rejects.toMatchObject({
      code: 'ENOENT',
    })
    expect(
      JSON.parse(await readFile(join(destination, 'project.json'), 'utf8')).pluginData,
    ).toEqual({ savedAs: true })
    expect(
      (await readdir(parent)).some((name) => name.endsWith('.staging') || name.endsWith('.backup')),
    ).toBe(false)
    expect(warningSink.record).not.toHaveBeenCalled()
  })

  it('keeps a committed Save As result and records only its exact leftover destination backup', async () => {
    const parent = await mkdtemp(join(tmpdir(), 'redencut-workspaces-'))
    const warningSink = {
      record: vi.fn(async () => {
        throw new Error('warning sink unavailable')
      }),
    }
    const remove = vi.fn(
      async (path: string, options?: { recursive?: boolean; force?: boolean }) => {
        if (path.endsWith('.backup')) throw new Error('backup is busy')
        await rm(path, options)
      },
    )
    const workspace = await ProjectWorkspace.initialize(parent, {
      cleanupWarningSink: warningSink,
      remove,
    })
    const destination = join(parent, 'Episode.redencut')
    await mkdir(destination)
    await writeFile(join(destination, 'old.txt'), 'old destination')

    const saved = await workspace.saveAs(destination, workspace.project)

    expect(saved.root).toBe(destination)
    expect(await readFile(join(destination, 'project.json'), 'utf8')).toContain('"version": 2')
    const backupName = (await readdir(parent)).find((name) => name.endsWith('.backup'))
    expect(backupName).toBeDefined()
    const backup = join(parent, backupName!)
    expect(await readFile(join(backup, 'old.txt'), 'utf8')).toBe('old destination')
    expect(warningSink.record).toHaveBeenCalledWith({
      path: backup,
      operation: 'save-as-publication',
      kind: 'destination-backup',
      cause: expect.objectContaining({ message: 'backup is busy' }),
    })
  })

  it('preserves both the active root and existing destination when stage preparation fails', async () => {
    const parent = await mkdtemp(join(tmpdir(), 'redencut-workspaces-'))
    const warningSink = { record: vi.fn() }
    const workspace = await ProjectWorkspace.initialize(parent, { cleanupWarningSink: warningSink })
    const originalRoot = workspace.root
    const destination = join(parent, 'Existing.redencut')
    await mkdir(destination)
    await writeFile(join(destination, 'sentinel.txt'), 'keep me')

    await expect(
      workspace.saveAs(destination, workspace.project, async () => {
        throw new Error('cache validation failed')
      }),
    ).rejects.toThrow('cache validation failed')

    expect(workspace.root).toBe(originalRoot)
    expect(workspace.descriptor.kind).toBe('temporary')
    expect(await readFile(join(destination, 'sentinel.txt'), 'utf8')).toBe('keep me')
    expect(warningSink.record).not.toHaveBeenCalled()
  })

  it('does not allow Save As to publish in place over a temporary workspace', async () => {
    const parent = await mkdtemp(join(tmpdir(), 'redencut-workspaces-'))
    const workspace = await ProjectWorkspace.initialize(parent)
    await expect(workspace.saveAs(workspace.root, workspace.project)).rejects.toThrow(
      'temporary workspace',
    )
    expect(workspace.descriptor.kind).toBe('temporary')
  })

  it('retains the previous saved package when Save As switches to a new package', async () => {
    const parent = await mkdtemp(join(tmpdir(), 'redencut-workspaces-'))
    const workspace = await ProjectWorkspace.initialize(parent)
    const first = join(parent, 'First.redencut')
    const second = join(parent, 'Second.redencut')
    const firstWorkspace = await workspace.saveAs(first, workspace.project)
    const secondWorkspace = await firstWorkspace.saveAs(second, firstWorkspace.project)
    expect(await readFile(join(first, 'project.json'), 'utf8')).toContain('"version": 2')
    expect(await readFile(join(second, 'project.json'), 'utf8')).toContain('"version": 2')
    expect(firstWorkspace.root).toBe(first)
    expect(secondWorkspace.root).toBe(second)
  })

  it('close deletes its exact temporary root without deleting its parent', async () => {
    const parent = await mkdtemp(join(tmpdir(), 'redencut-workspaces-'))
    const workspace = await ProjectWorkspace.initialize(parent)
    const temporaryRoot = workspace.root
    await writeFile(join(parent, 'keep.txt'), 'keep parent contents')

    await workspace.close()

    await expect(stat(temporaryRoot)).rejects.toMatchObject({ code: 'ENOENT' })
    expect(await readFile(join(parent, 'keep.txt'), 'utf8')).toBe('keep parent contents')
  })

  it('records a failed exact temporary-root retirement without rejecting the committed transition', async () => {
    const parent = await mkdtemp(join(tmpdir(), 'redencut-workspaces-'))
    const warningSink = { record: vi.fn() }
    let temporaryRoot = ''
    const remove = vi.fn(
      async (path: string, options?: { recursive?: boolean; force?: boolean }) => {
        if (path === temporaryRoot) throw new Error('temporary root is busy')
        await rm(path, options)
      },
    )
    const workspace = await ProjectWorkspace.initialize(parent, {
      cleanupWarningSink: warningSink,
      remove,
    })
    temporaryRoot = workspace.root

    await expect(workspace.close('workspace-switch')).resolves.toBeUndefined()

    await expect(stat(temporaryRoot)).resolves.toBeTruthy()
    expect(warningSink.record).toHaveBeenCalledWith({
      path: temporaryRoot,
      operation: 'workspace-switch',
      kind: 'temporary-workspace',
      cause: expect.objectContaining({ message: 'temporary root is busy' }),
    })
  })

  it('close never deletes a saved workspace root', async () => {
    const parent = await mkdtemp(join(tmpdir(), 'redencut-workspaces-'))
    const warningSink = { record: vi.fn() }
    const remove = vi.fn(async (path: string, options?: { recursive?: boolean; force?: boolean }) =>
      rm(path, options),
    )
    const workspace = await ProjectWorkspace.initialize(parent, {
      cleanupWarningSink: warningSink,
      remove,
    })
    const destination = join(parent, 'Saved.redencut')
    const saved = await workspace.saveAs(destination, workspace.project)

    await saved.close()

    expect(await readFile(join(destination, 'project.json'), 'utf8')).toContain('"version": 2')
    expect(remove).not.toHaveBeenCalledWith(destination, expect.anything())
    expect(warningSink.record).not.toHaveBeenCalled()
  })
})
