import assert from 'node:assert/strict'
import test from 'node:test'

import { createManagedPythonEnvironment } from './RuntimeEnvironment.mjs'

test('managed Python environment disables user/global and loader-path fallback', () => {
  const environment = createManagedPythonEnvironment('/runtime', {
    HOME: '/Users/example',
    PYTHONHOME: '/external/python',
    PYTHONUSERBASE: '/external/site',
    PYTHONPATH: '/external/modules',
    DYLD_LIBRARY_PATH: '/external/lib',
    DYLD_INSERT_LIBRARIES: '/external/injected.dylib',
    DYLD_FRAMEWORK_PATH: '/external/frameworks',
    LD_LIBRARY_PATH: '/external/lib',
    LD_PRELOAD: '/external/injected.so',
    LD_AUDIT: '/external/audit.so',
    PATH: '/usr/bin',
  })

  assert.equal(environment.PYTHONNOUSERSITE, '1')
  assert.equal(environment.PYTHONDONTWRITEBYTECODE, '1')
  assert.equal(environment.PATH, '/runtime/bin')
  for (const key of [
    'PYTHONHOME',
    'PYTHONUSERBASE',
    'PYTHONPATH',
    'DYLD_LIBRARY_PATH',
    'DYLD_INSERT_LIBRARIES',
    'DYLD_FRAMEWORK_PATH',
    'LD_LIBRARY_PATH',
    'LD_PRELOAD',
    'LD_AUDIT',
  ]) {
    assert.equal(key in environment, false)
  }
})
