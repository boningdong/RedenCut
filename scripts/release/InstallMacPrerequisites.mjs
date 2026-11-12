import { spawnSync } from 'node:child_process'

if (process.platform !== 'darwin' || process.arch !== 'arm64')
  throw new Error('macOS arm64 runner required')
for (const tool of ['cmake', 'ninja', 'pkg-config']) {
  const found = spawnSync('/bin/sh', ['-c', 'command -v "$1"', 'sh', tool], { stdio: 'ignore' })
  if (found.status === 0) continue
  const result = spawnSync('brew', ['install', tool], {
    stdio: 'inherit',
    env: { ...process.env, HOMEBREW_NO_AUTO_UPDATE: '1' },
  })
  if (result.error) throw result.error
  if (result.status !== 0) throw new Error(`Could not install ${tool}`)
}
