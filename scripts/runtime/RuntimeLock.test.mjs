import assert from 'node:assert/strict'
import test from 'node:test'
import { resolveRuntimeLock, readRuntimeLock } from './RuntimeLock.mjs'

test('platform overrides preserve shared definitions without mutating them', () => {
  const lock = {
    sources: { ffmpeg: { version: 'shared' }, lame: { version: 'native' } },
    data: { punktTab: { version: 'tables' } },
    platformOverrides: { linux: { sources: { lame: { version: 'linux' } } } },
  }
  const linux = resolveRuntimeLock(lock, 'linux')
  assert.equal(linux.sources.ffmpeg.version, 'shared')
  assert.equal(linux.sources.lame.version, 'linux')
  assert.equal(linux.data.punktTab.version, 'tables')
  assert.equal(resolveRuntimeLock(lock, 'darwin').sources.lame.version, 'native')
  assert.equal(lock.sources.lame.version, 'native')
  lock.sources.ffmpeg.version = 'updated'
  assert.equal(resolveRuntimeLock(lock, 'linux').sources.ffmpeg.version, 'updated')
})

test('the locked Linux recipe preserves its existing LAME version', async () => {
  const native = await readRuntimeLock({ platform: 'darwin' })
  const linux = await readRuntimeLock({ platform: 'linux' })
  assert.equal(native.sources.lame.version, '4.0')
  assert.equal(linux.sources.lame.version, '3.100')
  assert.deepEqual(linux.sources.ffmpeg, native.sources.ffmpeg)
  assert.deepEqual(linux.sources.whisperCpp, native.sources.whisperCpp)
  assert.deepEqual(linux.data, native.data)
})
