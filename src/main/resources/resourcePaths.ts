import { join } from 'node:path'
import type { ModelDefinition } from '../../shared/modelManifest.schema'
export function resourcePaths(
  root: string,
  model: ModelDefinition,
  modelsRoot = join(root, 'models'),
): { installed: string; staging: string } {
  const segments = [model.capability, model.id, model.revision]
  return {
    installed: join(modelsRoot, ...segments),
    staging: join(modelsRoot, '.staging', ...segments),
  }
}
