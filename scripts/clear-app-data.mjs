import { lstat, readFile, rename, rm, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join, resolve } from 'node:path'
import { randomUUID } from 'node:crypto'

// Developer maintenance only. Exit the app first so in-memory state cannot restore cleared data.
const usage = 'Usage: npm run clear:<onboarding|models> -- [--dry-run] [--user-data-dir PATH]'
async function main() {
  const [mode, ...args] = process.argv.slice(2)
  if (!['onboarding', 'models'].includes(mode)) throw new Error(usage)
  let dryRun = false
  let override
  for (let index = 0; index < args.length; index++) {
    if (args[index] === '--dry-run') dryRun = true
    else if (
      args[index] === '--user-data-dir' &&
      args[index + 1] &&
      !args[index + 1].startsWith('--')
    )
      override = args[++index]
    else throw new Error(usage)
  }
  // Match Electron's default appData/name layout; the package name is the running app name.
  const { name } = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'))
  const appData =
    process.platform === 'darwin'
      ? join(homedir(), 'Library', 'Application Support')
      : process.platform === 'win32'
        ? process.env.APPDATA || join(homedir(), 'AppData', 'Roaming')
        : process.env.XDG_CONFIG_HOME || join(homedir(), '.config')
  const root = resolve(override || join(appData, name))
  const targets = mode === 'models' ? ['models', 'staging'] : ['app-preferences.json']
  console.log(`Exit RedenCut before clearing data.\n${dryRun ? 'Preview' : 'Target'}: ${root}`)
  for (const name of targets)
    console.log(`${mode === 'models' ? 'Remove' : 'Reset onboarding only in'}: ${join(root, name)}`)
  // Refuse indirection so maintenance cannot traverse a linked data directory or preference file.
  for (const path of [root, ...targets.map((name) => join(root, name))]) {
    try {
      if ((await lstat(path)).isSymbolicLink()) throw new Error(`Refusing symbolic link: ${path}`)
    } catch (error) {
      if (error.code !== 'ENOENT') throw error
    }
  }
  if (dryRun) return
  if (mode === 'models') {
    for (const name of targets) await rm(join(root, name), { recursive: true, force: true })
  } else {
    const path = join(root, 'app-preferences.json')
    let stored
    try {
      stored = JSON.parse(await readFile(path, 'utf8'))
    } catch (error) {
      if (error.code === 'ENOENT') {
        console.log('No preferences saved; onboarding is already pending.')
        return
      }
      throw error
    }
    if (!stored || Array.isArray(stored) || typeof stored !== 'object' || stored.version !== 1)
      throw new Error('Unrecognized preferences; no changes made.')
    const temporary = join(root, `.clear-onboarding-${randomUUID()}.tmp`)
    try {
      await writeFile(
        temporary,
        JSON.stringify({ ...stored, onboardingDisposition: 'pending' }, null, 2) + '\n',
        { mode: 0o600, flag: 'wx' },
      )
      await rename(temporary, path)
    } finally {
      await rm(temporary, { force: true })
    }
  }
  console.log(
    mode === 'models'
      ? 'App model downloads cleared. Python, credentials, projects and preferences are unchanged.'
      : 'Onboarding reset. Other preferences are unchanged.',
  )
}
main().catch((error) => {
  console.error(error.message)
  process.exitCode = 1
})
