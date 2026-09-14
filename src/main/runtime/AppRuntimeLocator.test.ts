import { expect, it } from 'vitest'
import { AppRuntimeLocator } from './AppRuntimeLocator'
it('uses explicit development executables', () => {
  const locator = new AppRuntimeLocator({
    packaged: false,
    resourcesPath: '/unused',
    appPath: '/unused',
    env: { REDENCUT_FFMPEG_PATH: process.execPath },
  })
  expect(locator.getFfmpegPath()).toBe(process.execPath)
})
it('packaged resolution cannot fall back to developer tools', () => {
  const locator = new AppRuntimeLocator({
    packaged: true,
    resourcesPath: '/missing-bundle',
    appPath: '/unused',
    env: { REDENCUT_FFMPEG_PATH: process.execPath },
  })
  expect(() => locator.getFfmpegPath()).toThrow('runtime-unavailable:ffmpeg')
})
it('rejects a directory masquerading as a runtime executable', () => {
  const locator = new AppRuntimeLocator({
    packaged: false,
    resourcesPath: '/unused',
    appPath: '/unused',
    env: { REDENCUT_FFMPEG_PATH: process.cwd() },
  })
  expect(() => locator.getFfmpegPath()).toThrow('runtime-unavailable:ffmpeg')
})
