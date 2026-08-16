import { readFile } from 'fs/promises'
import { join } from 'path'
import { describe, expect, it } from 'vitest'

function parseDirectives(policy: string): Map<string, string[]> {
  return new Map(
    policy
      .split(';')
      .map((directive) => directive.trim().split(/\s+/))
      .filter(([name]) => name)
      .map(([name, ...sources]) => [name, sources]),
  )
}

describe('managed cache renderer security policy', () => {
  it('allows only the required renderer connection schemes without bypassing CSP', async () => {
    const rendererHtml = await readFile(join(__dirname, '../../renderer/index.html'), 'utf8')
    const mainSource = await readFile(join(__dirname, '../index.ts'), 'utf8')
    const policy = rendererHtml.match(
      /http-equiv="Content-Security-Policy"\s+content="([^"]+)"/,
    )?.[1]

    expect(policy).toBeDefined()
    expect(parseDirectives(policy!).get('connect-src')).toEqual(["'self'", 'podcut:'])
    expect(mainSource).not.toContain('bypassCSP')
  })
})
