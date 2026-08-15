import { mkdir, mkdtemp, readFile, readdir, stat, writeFile } from 'fs/promises'
import { tmpdir } from 'os'
import { join } from 'path'
import { describe, expect, it } from 'vitest'
import { ProjectFileSchema } from '../../shared/project.types'
import { ProjectWorkspace } from './ProjectWorkspace'

describe('ProjectWorkspace', () => {
  it('initializes a temporary managed bundle with a valid empty project', async () => {
    const parent = await mkdtemp(join(tmpdir(), 'podcut-workspaces-'))
    const workspace = await ProjectWorkspace.initialize(parent)
    const project = ProjectFileSchema.parse(
      JSON.parse(await readFile(join(workspace.root, 'project.json'), 'utf8')),
    )

    expect(workspace.descriptor.kind).toBe('temporary')
    expect(project.audioSources).toEqual([])
    expect(project.audioSettings.processingSampleRate).toBe(48_000)
  })

  it('writes project.json atomically without changing the workspace root', async () => {
    const parent = await mkdtemp(join(tmpdir(), 'podcut-workspaces-'))
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
    const parent = await mkdtemp(join(tmpdir(), 'podcut-workspaces-'))
    const workspace = await ProjectWorkspace.initialize(parent)
    const sourceId = '00000000-0000-4000-8000-000000000001'
    await mkdir(join(workspace.root, 'media', sourceId), { recursive: true })
    await writeFile(join(workspace.root, 'media', sourceId, 'kept.wav'), 'managed artifact')
    await mkdir(join(workspace.root, 'cache', 'orphan'), { recursive: true })
    await writeFile(join(workspace.root, 'cache', 'orphan', 'partial.bin'), 'crash leftover')
    const destination = join(parent, 'Episode.podcut')
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

    await workspace.saveAs(destination, project)

    expect(workspace.root).toBe(destination)
    expect(workspace.descriptor.kind).toBe('saved')
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
  })

  it('preserves both the active root and existing destination when stage preparation fails', async () => {
    const parent = await mkdtemp(join(tmpdir(), 'podcut-workspaces-'))
    const workspace = await ProjectWorkspace.initialize(parent)
    const originalRoot = workspace.root
    const destination = join(parent, 'Existing.podcut')
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
  })

  it('does not allow Save As to publish in place over a temporary workspace', async () => {
    const parent = await mkdtemp(join(tmpdir(), 'podcut-workspaces-'))
    const workspace = await ProjectWorkspace.initialize(parent)
    await expect(workspace.saveAs(workspace.root, workspace.project)).rejects.toThrow(
      'temporary workspace',
    )
    expect(workspace.descriptor.kind).toBe('temporary')
  })

  it('retains the previous saved package when Save As switches to a new package', async () => {
    const parent = await mkdtemp(join(tmpdir(), 'podcut-workspaces-'))
    const workspace = await ProjectWorkspace.initialize(parent)
    const first = join(parent, 'First.podcut')
    const second = join(parent, 'Second.podcut')
    await workspace.saveAs(first, workspace.project)
    await workspace.saveAs(second, workspace.project)
    expect(await readFile(join(first, 'project.json'), 'utf8')).toContain('"version": 1')
    expect(await readFile(join(second, 'project.json'), 'utf8')).toContain('"version": 1')
    expect(workspace.root).toBe(second)
  })
})
