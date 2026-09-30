import { require as tsRequire } from 'tsx/cjs/api'
const { resolveModelsPath } = tsRequire('../src/main/resources/ModelsPath.ts', import.meta.url)
import { lstat, readFile, realpath, rename, rm, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join, resolve } from 'node:path'
import { randomUUID } from 'node:crypto'

// Developer maintenance only. Exit the app first so in-memory state cannot restore cleared data.
const usage =
  'Usage: npm run clear:<onboarding|models> -- [--dry-run] [--user-data-dir PATH] [--models-path PATH]'
async function resolveExistingPath(path) {
  try {
    return await realpath(path)
  } catch (error) {
    if (error.code !== 'ENOENT') throw error
    return resolve(path)
  }
}

async function main() {
  const [mode, ...args] = process.argv.slice(2)
  if (!['onboarding', 'models'].includes(mode)) throw new Error(usage)
  let dryRun = false
  let modelsPath
  let override
  for (let index = 0; index < args.length; index++) {
    if (args[index] === '--dry-run') dryRun = true
    else if (
      args[index] === '--models-path' &&
      mode === 'models' &&
      args[index + 1] &&
      !args[index + 1].startsWith('--')
    )
      modelsPath = args[++index]
    else if (
      args[index] === '--user-data-dir' &&
      args[index + 1] &&
      !args[index + 1].startsWith('--')
    )
      override = args[++index]
    else throw new Error(usage)
  }
  // Electron development preferences use the package name; shared models use the product identity.
  const { name } = JSON.parse(
    await readFile(
      new URL(
        mode === 'onboarding' ? '../package.json' : '../src/shared/AppIdentity.json',
        import.meta.url,
      ),
      'utf8',
    ),
  )
  const appData =
    process.platform === 'darwin'
      ? join(homedir(), 'Library', 'Application Support')
      : process.platform === 'win32'
        ? process.env.APPDATA || join(homedir(), 'AppData', 'Roaming')
        : process.env.XDG_CONFIG_HOME || join(homedir(), '.config')
  const root = resolve(override || join(appData, name))
  const modelsRoot = resolveModelsPath({ modelsPath, userData: root })
  const targets =
    mode === 'models'
      ? [
          modelsRoot,
          ...(!modelsPath && !process.env.REDENCUT_MODELS_PATH ? [join(root, 'staging')] : []),
        ]
      : [join(root, 'app-preferences.json')]
  console.log(`Exit RedenCut before clearing data.\n${dryRun ? 'Preview' : 'Target'}: ${root}`)
  for (const name of targets)
    console.log(`${mode === 'models' ? 'Remove' : 'Reset onboarding only in'}: ${name}`)
  // Refuse indirection so maintenance cannot traverse a linked data directory or preference file.
  for (const path of [root, ...targets]) {
    try {
      if ((await lstat(path)).isSymbolicLink()) throw new Error(`Refusing symbolic link: ${path}`)
    } catch (error) {
      if (error.code !== 'ENOENT') throw error
    }
  }
  if (mode === 'models') {
    // Resolve both sides: ancestor links can alias protected directories while
    // legitimate system links such as macOS /var must remain usable.
    const protectedPaths = await Promise.all(
      [resolve('/'), homedir(), process.cwd(), root].map(resolveExistingPath),
    )
    for (const target of targets) {
      if (protectedPaths.includes(await resolveExistingPath(target)))
        throw new Error('Refusing broad models path')
    }
  }
  if (dryRun) return
  if (mode === 'models') {
    for (const name of targets) await rm(name, { recursive: true, force: true })
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
