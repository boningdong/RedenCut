import { expect, it } from 'vitest'
import { resolveModelsPath } from './ModelsPath'

it('shares the macOS application root and applies explicit, environment, then userData precedence', () => {
  const defaults = { platform: 'darwin' as const, home: '/home/developer', environment: {} }
  expect(resolveModelsPath(defaults)).toBe(
    '/home/developer/Library/Application Support/RedenCut/models',
  )
  expect(resolveModelsPath({ ...defaults, userData: '/isolated' })).toBe('/isolated/models')
  expect(
    resolveModelsPath({
      ...defaults,
      userData: '/isolated',
      environment: { REDENCUT_MODELS_PATH: '/shared models' },
    }),
  ).toBe('/shared models')
  expect(
    resolveModelsPath({
      ...defaults,
      modelsPath: '/explicit',
      environment: { REDENCUT_MODELS_PATH: '/shared' },
    }),
  ).toBe('/explicit')
})
