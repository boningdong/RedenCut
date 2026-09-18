import { join } from 'node:path'

const removedVariables = ['PYTHONHOME', 'PYTHONUSERBASE', 'PYTHONPATH']

export function createSanitizedRuntimeEnvironment(sourceEnvironment = process.env) {
  const environment = { ...sourceEnvironment }
  for (const variable of removedVariables) delete environment[variable]
  for (const variable of Object.keys(environment)) {
    if (/^(?:LD_|DYLD_)/.test(variable)) delete environment[variable]
  }
  return environment
}

export function createManagedPythonEnvironment(runtimeRoot, sourceEnvironment = process.env) {
  const environment = createSanitizedRuntimeEnvironment(sourceEnvironment)
  environment.PYTHONNOUSERSITE = '1'
  environment.PYTHONDONTWRITEBYTECODE = '1'
  environment.PATH = join(runtimeRoot, 'bin')
  return environment
}
