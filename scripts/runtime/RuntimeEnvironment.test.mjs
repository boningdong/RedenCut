import assert from 'node:assert/strict'
import test from 'node:test'

import {
  createManagedPythonEnvironment,
  createOfflineAlignmentCheckEnvironment,
} from './RuntimeEnvironment.mjs'

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
    NLTK_DATA: '/external/cached-data',
  })

  assert.equal(environment.PYTHONNOUSERSITE, '1')
  assert.equal(environment.PYTHONDONTWRITEBYTECODE, '1')
  assert.equal(environment.PATH, '/runtime/bin')
  assert.equal(environment.NLTK_DATA, '/runtime/nltk_data')
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

test('offline alignment check ignores explicit host cache locations', () => {
  const environment = createOfflineAlignmentCheckEnvironment('/runtime', '/temporary-check', {
    HF_HUB_CACHE: '/populated/hub',
    HUGGINGFACE_HUB_CACHE: '/populated/old-hub',
    TRANSFORMERS_CACHE: '/populated/transformers',
    TORCH_HOME: '/populated/torch',
    PYTORCH_PRETRAINED_BERT_CACHE: '/populated/bert',
    PYTORCH_TRANSFORMERS_CACHE: '/populated/old-transformers',
    HF_ASSETS_CACHE: '/populated/assets',
    HF_XET_CACHE: '/populated/xet',
  })
  for (const key of [
    'HF_HUB_CACHE',
    'HUGGINGFACE_HUB_CACHE',
    'TRANSFORMERS_CACHE',
    'PYTORCH_PRETRAINED_BERT_CACHE',
    'PYTORCH_TRANSFORMERS_CACHE',
    'HF_ASSETS_CACHE',
    'HF_XET_CACHE',
  ])
    assert.equal(key in environment, false)
  assert.equal(environment.TORCH_HOME, '/temporary-check/torch')
  assert.equal(environment.HF_HOME, '/temporary-check/hf')
})

test('offline alignment check isolates home and caches without changing the supplied environment', () => {
  const sourceEnvironment = {
    HOME: '/user/home',
    NLTK_DATA: '/user/nltk',
    XDG_CACHE_HOME: '/user/cache',
    MPLCONFIGDIR: '/user/matplotlib',
    HF_TOKEN: 'private',
    API_SECRET: 'private',
    SERVICE_PASSWORD: 'private',
  }
  const originalEnvironment = { ...sourceEnvironment }
  const environment = createOfflineAlignmentCheckEnvironment(
    '/runtime',
    '/temporary-check',
    sourceEnvironment,
  )
  assert.equal(environment.HOME, '/temporary-check')
  assert.equal(environment.XDG_CACHE_HOME, '/temporary-check/cache')
  assert.equal(environment.MPLCONFIGDIR, '/temporary-check/matplotlib')
  assert.equal(environment.NLTK_DATA, '/runtime/nltk_data')
  assert.equal(environment.HF_HUB_OFFLINE, '1')
  assert.equal(environment.TRANSFORMERS_OFFLINE, '1')
  for (const key of ['HF_TOKEN', 'API_SECRET', 'SERVICE_PASSWORD'])
    assert.equal(key in environment, false)
  assert.deepEqual(sourceEnvironment, originalEnvironment)
})
