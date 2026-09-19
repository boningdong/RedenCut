import { createHash } from 'crypto'
import { writeFileSync } from 'fs'
import { mkdir, mkdtemp, readFile, readdir, rename, rm, symlink, writeFile } from 'fs/promises'
import { tmpdir } from 'os'
import { dirname, join } from 'path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { AudioSourceSchema, type AudioSource } from '../../shared/ProjectTypes'
import { MediaRecoveryService } from './MediaRecoveryService'

describe('MediaRecoveryService', () => {
  let directory: string
  let root: string
  let selected: string
  let source: AudioSource
  const contents = Buffer.alloc(180_000, 42)
  const service = new MediaRecoveryService()
  beforeEach(async () => {
    directory = await mkdtemp(join(tmpdir(), 'redencut-recovery-'))
    root = join(directory, 'project')
    await mkdir(root)
    selected = join(directory, 'selected.wav')
    await writeFile(selected, contents)
    source = AudioSourceSchema.parse({
      id: '00000000-0000-4000-8000-000000000001',
      displayName: 'Original.wav',
      location: { mode: 'copy', path: 'media/00000000-0000-4000-8000-000000000001/original.wav' },
      fingerprint: {
        sha256: createHash('sha256').update(contents).digest('hex'),
        byteLength: contents.length,
        modifiedTimeMs: 123,
      },
      metadata: {
        durationSeconds: 4,
        sampleRate: 48000,
        channels: 1,
        codec: 'wav',
        bitrateKbps: 768,
      },
    })
  })
  afterEach(async () => {
    await rm(directory, { recursive: true, force: true })
  })
  const signal = (): AbortSignal => new AbortController().signal

  it('finds only absent copy sources and leaves existing content for normal validation', async () => {
    const reference = {
      ...source,
      location: { mode: 'reference' as const, path: selected + '.absent' },
    }
    expect(await service.findMissing(root, [source, reference])).toEqual([source])
    await mkdir(dirname(join(root, source.location.path)), { recursive: true })
    await writeFile(join(root, source.location.path), 'corrupt')
    expect(await service.findMissing(root, [source])).toEqual([])
  })

  it('restores exact bytes without changing the source metadata and cleans staging', async () => {
    const original = structuredClone(source)
    const progress: number[] = []
    await service.restore(root, source, selected, signal(), (bytes) => progress.push(bytes))
    expect(await readFile(join(root, source.location.path))).toEqual(contents)
    expect(source).toEqual(original)
    expect(progress.at(-1)).toBe(contents.length)
    expect(await readdir(root)).toEqual(['media'])
  })

  it.each(['hash', 'length'])('rejects a %s mismatch without publishing', async (kind) => {
    if (kind === 'hash') source.fingerprint.sha256 = 'a'.repeat(64)
    else source.fingerprint.byteLength++
    await expect(service.restore(root, source, selected, signal(), () => {})).rejects.toMatchObject(
      { reason: 'content-mismatch' },
    )
    expect(await service.findMissing(root, [source])).toEqual([source])
    expect((await readdir(root)).filter((name) => name.startsWith('.media-recovery-'))).toEqual([])
  })

  it('aborts an in-flight copy and cleans staging', async () => {
    const controller = new AbortController()
    await expect(
      service.restore(root, source, selected, controller.signal, () => controller.abort()),
    ).rejects.toMatchObject({ name: 'AbortError' })
    expect(await service.findMissing(root, [source])).toEqual([source])
    expect((await readdir(root)).filter((name) => name.startsWith('.media-recovery-'))).toEqual([])
  })

  it('never replaces an existing destination', async () => {
    await mkdir(dirname(join(root, source.location.path)), { recursive: true })
    await writeFile(join(root, source.location.path), 'keep')
    await expect(service.restore(root, source, selected, signal(), () => {})).rejects.toMatchObject(
      { reason: 'destination-conflict' },
    )
    expect(await readFile(join(root, source.location.path), 'utf8')).toBe('keep')
  })

  it.each(['dangling', 'outside', 'directory'])(
    'does not recover a %s destination',
    async (kind) => {
      const destination = join(root, source.location.path)
      await mkdir(dirname(destination), { recursive: true })
      if (kind === 'directory') await mkdir(destination)
      else await symlink(kind === 'dangling' ? selected + '.absent' : selected, destination)
      await expect(service.findMissing(root, [source])).rejects.toThrow()
      await expect(
        service.restore(root, source, selected, signal(), () => {}),
      ).rejects.toMatchObject({ reason: 'destination-conflict' })
    },
  )

  it('rejects a dangling symlink parent rather than treating it as missing', async () => {
    await symlink(join(directory, 'absent'), join(root, 'media'))
    await expect(service.findMissing(root, [source])).rejects.toThrow()
    await expect(service.restore(root, source, selected, signal(), () => {})).rejects.toMatchObject(
      { reason: 'destination-conflict' },
    )
  })

  it('revalidates destination parents after streaming before publication', async () => {
    let swap: Promise<void> | undefined
    const outside = join(directory, 'outside')
    await mkdir(outside)
    await expect(
      service.restore(root, source, selected, signal(), () => {
        swap ??= rename(join(root, 'media'), join(root, 'old-media')).then(() =>
          symlink(outside, join(root, 'media')),
        )
      }),
    ).rejects.toMatchObject({ reason: 'destination-conflict' })
    await swap
    expect(await readdir(outside)).toEqual([])
  })

  it('does not clobber a destination created during streaming', async () => {
    let created = false
    await expect(
      service.restore(root, source, selected, signal(), () => {
        if (!created) {
          created = true
          writeFileSync(join(root, source.location.path), 'concurrent original')
        }
      }),
    ).rejects.toMatchObject({ reason: 'destination-conflict' })
    expect(await readFile(join(root, source.location.path), 'utf8')).toBe('concurrent original')
  })

  it('keeps an earlier restored original when another restore is cancelled', async () => {
    await service.restore(root, source, selected, signal(), () => {})
    const second = AudioSourceSchema.parse({
      ...source,
      id: '00000000-0000-4000-8000-000000000002',
      location: { mode: 'copy', path: 'media/00000000-0000-4000-8000-000000000002/second.wav' },
    })
    const controller = new AbortController()
    await expect(
      service.restore(root, second, selected, controller.signal, () => controller.abort()),
    ).rejects.toMatchObject({ name: 'AbortError' })
    expect(await readFile(join(root, source.location.path))).toEqual(contents)
    expect(await service.findMissing(root, [source, second])).toEqual([second])
  })

  it('does no filesystem work for a pre-cancelled restore', async () => {
    const controller = new AbortController()
    controller.abort()
    await expect(
      service.restore(root, source, selected, controller.signal, () => {}),
    ).rejects.toMatchObject({ name: 'AbortError' })
    expect(await readdir(root)).toEqual([])
  })

  it('classifies unavailable selection as a read failure', async () => {
    await expect(
      service.restore(root, source, selected + '.absent', signal(), () => {}),
    ).rejects.toMatchObject({ reason: 'read-failed' })
  })
})
