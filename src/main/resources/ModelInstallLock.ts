import { mkdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises'
import { hostname } from 'node:os'
import { dirname, join } from 'node:path'
import { randomUUID } from 'node:crypto'

/** Recover crashed local installers without taking ownership from a live process. */
export async function acquireModelInstallLock(path: string): Promise<() => Promise<void>> {
  await mkdir(dirname(path), { recursive: true })
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      await mkdir(path)
      try {
        await writeFile(
          join(path, 'owner.json'),
          JSON.stringify({ pid: process.pid, host: hostname() }),
        )
      } catch (error) {
        await rm(path, { recursive: true, force: true })
        throw error
      }
      return () => rm(path, { recursive: true, force: true })
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error
    }
    let stale = false
    const observed = await stat(path).catch(() => undefined)
    if (!observed) continue
    let observedOwner: string | undefined
    try {
      observedOwner = await readFile(join(path, 'owner.json'), 'utf8')
      const owner = JSON.parse(observedOwner)
      if (owner.host === hostname() && Number.isInteger(owner.pid) && owner.pid > 0) {
        try {
          process.kill(owner.pid, 0)
        } catch (error) {
          stale = (error as NodeJS.ErrnoException).code === 'ESRCH'
        }
      }
    } catch {
      // A crash between mkdir and writing the owner must not block preparation forever.
      try {
        stale = Date.now() - (await stat(path)).mtimeMs > 300_000
      } catch {
        continue
      }
    }
    if (!stale) throw new Error('model-install-in-progress')
    // Serialize recovery and recheck the directory identity: another retry may have
    // already replaced this stale lock with a live installer's lock.
    const recovery = join(path, '.recovery')
    try {
      await mkdir(recovery)
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') continue
      if ((error as NodeJS.ErrnoException).code === 'EEXIST')
        throw new Error('model-install-in-progress', { cause: error })
      throw error
    }
    const current = await stat(path)
    const currentOwner = await readFile(join(path, 'owner.json'), 'utf8').catch(() => undefined)
    if (
      current.ino !== observed.ino ||
      current.dev !== observed.dev ||
      currentOwner !== observedOwner
    ) {
      await rm(recovery, { recursive: true, force: true })
      continue
    }
    const abandoned = path + '.abandoned-' + randomUUID()
    try {
      await rename(path, abandoned)
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') continue
      throw error
    }
    await rm(abandoned, { recursive: true, force: true })
  }
  throw new Error('model-install-in-progress')
}
