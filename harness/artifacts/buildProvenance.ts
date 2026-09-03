import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

export function observeBuildProvenance(repositoryRoot: string) {
  const version = (name: string): string =>
    JSON.parse(readFileSync(join(repositoryRoot, 'node_modules', name, 'package.json'), 'utf8'))
      .version
  return {
    observedAt: new Date().toISOString(),
    versions: {
      node: process.version,
      electron: version('electron'),
      playwright: version('playwright'),
      playwrightMcp: version('@playwright/mcp'),
      mcpSdk: version('@modelcontextprotocol/sdk'),
    },
    // Observes the checkout, not a content-addressed attestation of prebuilt output.
    checkout: {
      commit: execFileSync('git', ['rev-parse', 'HEAD'], {
        cwd: repositoryRoot,
        encoding: 'utf8',
      }).trim(),
      dirty:
        execFileSync('git', ['status', '--porcelain'], {
          cwd: repositoryRoot,
          encoding: 'utf8',
        }).trim().length > 0,
    },
  }
}
