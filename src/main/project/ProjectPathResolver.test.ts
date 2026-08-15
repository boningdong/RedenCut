import { mkdtemp, mkdir, realpath, symlink } from 'fs/promises'
import { tmpdir } from 'os'
import { join } from 'path'
import { describe, expect, it } from 'vitest'
import { ProjectPathResolver } from './ProjectPathResolver'

describe('ProjectPathResolver', () => {
  it('resolves a normalized project-relative path inside the bundle', async () => {
    const root = await mkdtemp(join(tmpdir(), 'podcut-path-'))
    const resolver = new ProjectPathResolver(root)

    const canonicalRoot = await realpath(root)
    await expect(resolver.resolve('media/source/episode.mp3')).resolves.toBe(
      join(canonicalRoot, 'media/source/episode.mp3'),
    )
  })

  it.each(['/tmp/file', 'C:/file', 'C:\\file', '../file', 'media\\file', './file', 'a//b'])(
    'rejects unsafe path %s',
    async (unsafe) => {
      const root = await mkdtemp(join(tmpdir(), 'podcut-path-'))
      await expect(new ProjectPathResolver(root).resolve(unsafe)).rejects.toThrow(
        'Invalid project-relative path',
      )
    },
  )

  it('rejects a symlink whose target escapes the bundle', async () => {
    const root = await mkdtemp(join(tmpdir(), 'podcut-path-'))
    const outside = await mkdtemp(join(tmpdir(), 'podcut-outside-'))
    await mkdir(join(root, 'cache'))
    await symlink(outside, join(root, 'cache', 'escape'))

    await expect(new ProjectPathResolver(root).resolve('cache/escape/audio.f32le')).rejects.toThrow(
      'escapes project bundle',
    )
  })
})
