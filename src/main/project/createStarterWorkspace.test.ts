import { test, expect } from 'vitest'
import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { createStarterWorkspace } from './createStarterWorkspace'

test('sample creates original playable WAV and remains temporary until saved', async () => {
  const root = await mkdtemp(join(tmpdir(), 'starter-test-'))
  try {
    const workspace = await createStarterWorkspace(root, 'sample')
    expect(workspace.descriptor.kind).toBe('temporary')
    expect(workspace.project.audioSources).toHaveLength(1)
    expect(workspace.project.tracks[0].clips[0].sourceEnd).toBe(8)
    const wav = await readFile(
      join(workspace.root, 'media/f09c7ac2-443a-4a6a-92b7-4057c0e639bf/sample-tones.wav'),
    )
    expect(wav.subarray(0, 4).toString()).toBe('RIFF')
    expect(wav.readUInt32LE(40)).toBe(768000)
    await workspace.close()
    expect(await readdir(root)).toEqual([])
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('empty starter has no media and separate temporary ownership', async () => {
  const root = await mkdtemp(join(tmpdir(), 'starter-test-'))
  try {
    const workspace = await createStarterWorkspace(root, 'empty')
    expect(workspace.project.tracks).toEqual([])
    expect(workspace.project.audioSources).toEqual([])
    expect(workspace.descriptor.kind).toBe('temporary')
    await workspace.close()
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})
