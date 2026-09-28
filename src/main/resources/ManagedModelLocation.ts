import { isAbsolute, join, relative, resolve } from 'node:path'
import { resolveModelsPath } from './ModelsPath'
import type { RuntimeLocationOptions } from '../runtime/AppRuntimeLocator'

export interface ManagedModelLocation {
  root: string
  displayRoot: string
  source: 'development-runtime' | 'bundled'
}

export function managedModelLocation(
  options: RuntimeLocationOptions & { userData?: string },
): ManagedModelLocation {
  const root = resolve(
    options.packaged
      ? join(options.resourcesPath, 'models')
      : resolveModelsPath({ environment: options.env, userData: options.userData }),
  )
  const fromProject = relative(resolve(options.appPath), root)
  return {
    root,
    displayRoot:
      !options.packaged && fromProject && !fromProject.startsWith('..') && !isAbsolute(fromProject)
        ? fromProject.split('\\').join('/')
        : root,
    source: options.packaged ? 'bundled' : 'development-runtime',
  }
}
