import { expect, test } from 'vitest'
import { offlineEnvironment } from './inferenceEnvironment'

test('isolates managed native/Python execution from inherited loader and user-site overrides', () => {
  const env = offlineEnvironment({
    HOME: '/home/test',
    PYTHONHOME: '/system/python',
    PYTHONUSERBASE: '/system/packages',
    PYTHONPATH: '/approved/worker/src',
    LD_LIBRARY_PATH: '/system/libs',
    LD_PRELOAD: '/bad.so',
    DYLD_LIBRARY_PATH: '/brew/lib',
    DYLD_FALLBACK_LIBRARY_PATH: '/other/lib',
    DYLD_INSERT_LIBRARIES: '/bad.dylib',
    HF_TOKEN: 'secret',
    HF_TOKEN_PATH: '/token',
  })
  expect(env).toMatchObject({
    HOME: '/home/test',
    PYTHONPATH: '/approved/worker/src',
    PYTHONNOUSERSITE: '1',
    HF_HUB_OFFLINE: '1',
  })
  for (const key of [
    'PYTHONHOME',
    'PYTHONUSERBASE',
    'LD_LIBRARY_PATH',
    'LD_PRELOAD',
    'DYLD_LIBRARY_PATH',
    'DYLD_FALLBACK_LIBRARY_PATH',
    'DYLD_INSERT_LIBRARIES',
    'HF_TOKEN',
    'HF_TOKEN_PATH',
  ])
    expect(env[key]).toBeUndefined()
})
