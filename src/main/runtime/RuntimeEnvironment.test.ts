import { expect, it } from 'vitest'
import { runtimeEnvironment } from './RuntimeEnvironment'

it('keeps normal process configuration but excludes every external native loader override', () => {
  const input = {
    PATH: '/tools',
    HOME: '/home/developer',
    LANG: 'en_US.UTF-8',
    LD_LIBRARY_PATH: '/external',
    LD_PRELOAD: '/external.so',
    LD_AUDIT: '/audit.so',
    DYLD_LIBRARY_PATH: '/external',
    DYLD_FALLBACK_LIBRARY_PATH: '/fallback',
    DYLD_FRAMEWORK_PATH: '/frameworks',
    DYLD_INSERT_LIBRARIES: '/injected.dylib',
    DYLD_ROOT_PATH: '/other-root',
    DYLD_IMAGE_SUFFIX: '_debug',
  }
  expect(runtimeEnvironment(input)).toEqual({
    PATH: '/tools',
    HOME: '/home/developer',
    LANG: 'en_US.UTF-8',
  })
  expect(input.LD_LIBRARY_PATH).toBe('/external')
})
