import { join } from 'node:path'
import type { ModelDefinition } from '../../shared/modelManifest.schema'
export function resourcePaths(
  root: string,
  model: ModelDefinition,
): { installed: string; staging: string } {
  const segments = [model.capability, model.id, model.revision]
  return {
    installed: join(root, 'models', ...segments),
    staging: join(root, 'staging', ...segments),
  }
}
