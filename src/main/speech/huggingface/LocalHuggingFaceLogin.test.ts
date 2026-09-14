import { afterEach, expect, it } from 'vitest'
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { LocalHuggingFaceLogin } from './LocalHuggingFaceLogin'
const roots: string[] = []
async function root() {
  const path = await mkdtemp(join(tmpdir(), 'hf-local-test-'))
  roots.push(path)
  return path
}
afterEach(async () => {
  for (const path of roots.splice(0)) await rm(path, { recursive: true, force: true })
})
it('reads only the active login path, respecting HF_HOME and HF_TOKEN_PATH', async () => {
  const path = await root()
  await writeFile(join(path, 'token'), 'hf_fromhome')
  await writeFile(join(path, 'chosen'), 'hf_explicit')
  expect(await new LocalHuggingFaceLogin({ HF_HOME: path }, path).read()).toBe('hf_fromhome')
  expect(
    await new LocalHuggingFaceLogin(
      { HF_HOME: path, HF_TOKEN_PATH: join(path, 'chosen') },
      path,
    ).read(),
  ).toBe('hf_explicit')
  expect(
    await new LocalHuggingFaceLogin({ HF_HOME: path, HF_TOKEN: 'hf_environment' }, path).read(),
  ).toBe('hf_environment')
})
it('uses XDG/default cache locations and never returns secrets in detection results', async () => {
  const home = await root()
  const folder = join(home, '.cache', 'huggingface')
  await mkdir(folder, { recursive: true })
  await writeFile(join(folder, 'token'), 'hf_private')
  const login = new LocalHuggingFaceLogin({}, home)
  expect(await login.detect()).toEqual({ status: 'found' })
  expect(
    await new LocalHuggingFaceLogin({ XDG_CACHE_HOME: join(home, '.cache') }, home).read(),
  ).toBe('hf_private')
  expect(JSON.stringify(await login.detect())).not.toContain('hf_private')
})
it('distinguishes missing and unreadable credentials without inspecting other token stores', async () => {
  const home = await root()
  const login = new LocalHuggingFaceLogin({ HF_TOKEN_PATH: join(home, 'active') }, home)
  expect(await login.detect()).toEqual({ status: 'missing' })
  await writeFile(join(home, 'active'), 'invalid-secret')
  expect(await login.detect()).toEqual({ status: 'unavailable' })
})

it('reads long OAuth credentials from the CLI token file', async () => {
  const home = await root()
  const token = 'hf_oauth_' + 'aB0-_'.repeat(160) + '.signature'
  await writeFile(join(home, 'token'), token + '\n')
  const login = new LocalHuggingFaceLogin({ HF_HOME: home }, home)
  expect(await login.detect()).toEqual({ status: 'found' })
  expect(await login.read()).toBe(token)
})
