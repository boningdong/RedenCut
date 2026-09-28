import { expect, it } from 'vitest'
import { spawn } from 'node:child_process'
import { once } from 'node:events'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir, hostname } from 'node:os'
import { join } from 'node:path'
import { acquireModelInstallLock } from './ModelInstallLock'
it('rejects live owners and recovers an exited local owner', async () => {
  const root = await mkdtemp(join(tmpdir(), 'model-lock-'))
  const lock = join(root, 'lock')
  try {
    const release = await acquireModelInstallLock(lock)
    await expect(acquireModelInstallLock(lock)).rejects.toThrow('model-install-in-progress')
    await release()
    const child = spawn(process.execPath, ['-e', 'process.exit(0)'])
    await once(child, 'exit')
    await mkdir(lock)
    await writeFile(join(lock, 'owner.json'), JSON.stringify({ pid: child.pid, host: hostname() }))
    const recovered = await acquireModelInstallLock(lock)
    await recovered()
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})
