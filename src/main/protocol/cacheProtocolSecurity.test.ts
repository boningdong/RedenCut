import { readFile } from 'fs/promises'
import { join } from 'path'
import { describe, expect, it } from 'vitest'

function parseDirectives(policy: string): Map<string, string[]> {
  const directives = new Map<string, string[]>()
  for (const [name, ...sources] of policy
    .split(';')
    .map((directive) => directive.trim().split(/\s+/))
    .filter(([name]) => name)) {
    if (directives.has(name)) throw new Error(`Duplicate CSP directive: ${name}`)
    directives.set(name, sources)
  }
  return directives
}

describe('managed cache renderer security policy', () => {
  it('allows only the required renderer connection schemes without bypassing CSP', async () => {
    const rendererHtml = await readFile(join(__dirname, '../../renderer/index.html'), 'utf8')
    const mainSource = await readFile(join(__dirname, '../index.ts'), 'utf8')
    const policy = rendererHtml.match(
      /http-equiv="Content-Security-Policy"\s+content="([^"]+)"/,
    )?.[1]

    expect(policy).toBeDefined()
    const directives = parseDirectives(policy!)
    expect([...directives].filter(([name]) => name === 'connect-src')).toEqual([
      ['connect-src', ["'self'", 'podcut:']],
    ])
    expect(mainSource).not.toContain('bypassCSP')
  })

  it('rejects duplicate directive names instead of silently accepting the last one', () => {
    expect(() =>
      parseDirectives("default-src 'self'; connect-src 'self'; connect-src podcut:"),
    ).toThrow('Duplicate CSP directive: connect-src')
  })
})
