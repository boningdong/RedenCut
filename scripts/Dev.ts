import { spawn } from 'node:child_process'
import { resolve } from 'node:path'
import { resolveModelsPath } from '../src/main/resources/ModelsPath'
const args = process.argv.slice(2)
let modelsPath: string | undefined
for (let index = 0; index < args.length; index++) {
  if (args[index] !== '--models-path') continue
  if (modelsPath || !args[index + 1] || args[index + 1].startsWith('--'))
    throw new Error('--models-path requires one directory')
  modelsPath = args[index + 1]
  args.splice(index, 2)
  index--
}
const child = spawn(
  process.execPath,
  [resolve(__dirname, '../node_modules/electron-vite/bin/electron-vite.js'), 'dev', ...args],
  {
    stdio: 'inherit',
    env: { ...process.env, REDENCUT_MODELS_PATH: resolveModelsPath({ modelsPath }) },
  },
)
for (const signal of ['SIGINT', 'SIGTERM'] as const) process.on(signal, () => child.kill(signal))
child.on('error', (error) => {
  console.error(error.message)
  process.exitCode = 1
})
child.on('exit', (code, signal) => {
  process.exitCode = code ?? (signal === 'SIGINT' ? 130 : 1)
})
