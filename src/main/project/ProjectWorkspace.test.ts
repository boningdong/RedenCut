import { mkdir, mkdtemp, readFile, readdir, writeFile } from 'fs/promises'
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
    await mkdir(join(workspace.root, 'media'))
    await writeFile(join(workspace.root, 'media', 'kept.txt'), 'managed artifact')
    const destination = join(parent, 'Episode.podcut')
    await mkdir(destination)
    await writeFile(join(destination, 'old.txt'), 'old destination')
    const project = { ...workspace.project, pluginData: { savedAs: true } }

    await workspace.saveAs(destination, project)

    expect(workspace.root).toBe(destination)
    expect(workspace.descriptor.kind).toBe('saved')
    expect(await readFile(join(destination, 'media', 'kept.txt'), 'utf8')).toBe('managed artifact')
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
})
