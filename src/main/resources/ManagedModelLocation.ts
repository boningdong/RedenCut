import { isAbsolute, join, relative, resolve } from 'node:path'
import type { RuntimeLocationOptions } from '../runtime/AppRuntimeLocator'

export interface ManagedModelLocation {
  root: string
  displayRoot: string
  source: 'development-runtime' | 'bundled'
}

export function managedModelLocation(options: RuntimeLocationOptions): ManagedModelLocation {
  const root = resolve(
    options.packaged
      ? join(options.resourcesPath, 'models')
      : (options.env ?? process.env).REDENCUT_MODELS_ROOT ||
          join(options.appPath, '.runtime/models'),
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
