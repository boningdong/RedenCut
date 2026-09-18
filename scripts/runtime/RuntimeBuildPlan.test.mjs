import assert from 'node:assert/strict'
import test from 'node:test'

import { createDarwinArm64BuildPlan, requireSupportedBuildTarget } from './RuntimeBuildPlan.mjs'

test('build plan disables GPL, nonfree, autodetected and version-3 FFmpeg features', () => {
  const plan = createDarwinArm64BuildPlan('/work')
  assert.deepEqual(
    ['--disable-autodetect', '--disable-gpl', '--disable-nonfree', '--disable-version3'].map(
      (flag) => plan.ffmpeg.configureArguments.includes(flag),
    ),
    [true, true, true, true],
  )
  assert.equal(plan.ffmpeg.configureArguments.includes('--enable-libmp3lame'), true)
  assert.equal(plan.ffmpeg.configureArguments.includes('--enable-shared'), true)
  assert.equal(plan.whisper.cmakeArguments.includes('-DGGML_NATIVE=OFF'), true)
  assert.equal(plan.whisper.cmakeArguments.includes('-DGGML_CPU_ARM_ARCH=armv8-a'), true)
  assert.equal(plan.whisper.cmakeArguments.includes('-DGGML_METAL=ON'), true)
  assert.equal(plan.whisper.cmakeArguments.includes('-DGGML_METAL_EMBED_LIBRARY=ON'), true)
})

test('full runtime build rejects platforms that have not been certified', () => {
  assert.doesNotThrow(() => requireSupportedBuildTarget('darwin', 'arm64'))
  assert.throws(() => requireSupportedBuildTarget('linux', 'arm64'), /supports only darwin-arm64/i)
  assert.throws(() => requireSupportedBuildTarget('darwin', 'x64'), /supports only darwin-arm64/i)
})
