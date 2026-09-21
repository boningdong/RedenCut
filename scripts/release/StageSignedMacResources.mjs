import { execFileSync } from 'node:child_process'
import { cp, readdir } from 'node:fs/promises'
import { join } from 'node:path'

function signOuterApp(appPath, entitlementsPath) {
  execFileSync(
    'codesign',
    ['--force', '--sign', '-', '--options', 'runtime', '--entitlements', entitlementsPath, appPath],
    { stdio: 'inherit' },
  )
}

// osx-sign walks every file in Contents before it consults signIgnore. The
// managed Python tree is large enough to exhaust the GitHub runner's fd limit.
export async function stageSignedMacResources({
  appPath,
  resourcesPath,
  entitlementsPath,
  sign = signOuterApp,
}) {
  const destination = join(appPath, 'Contents', 'Resources')
  for (const name of await readdir(resourcesPath)) {
    await cp(join(resourcesPath, name), join(destination, name), {
      recursive: true,
      force: false,
      errorOnExist: true,
      verbatimSymlinks: true,
    })
  }
  await sign(appPath, entitlementsPath)
}
