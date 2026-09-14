import { LocalHuggingFaceLogin } from './LocalHuggingFaceLogin'
import { afterEach, expect, it } from 'vitest'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { HuggingFaceTokenStore } from './HuggingFaceTokenStore'
import { HuggingFaceAccessService } from './HuggingFaceAccessService'
import type { ModelDefinition } from '../../../shared/modelManifest.schema'
const dirs: string[] = []
afterEach(async () => {
  for (const d of dirs.splice(0)) await rm(d, { recursive: true, force: true })
})
async function makeStore(available = true, backend = 'keychain') {
  const dir = await mkdtemp(join(tmpdir(), 'secret-test-'))
  dirs.push(dir)
  const path = join(dir, 'token')
  return {
    path,
    store: new HuggingFaceTokenStore(path, {
      isEncryptionAvailable: () => available,
      getSelectedStorageBackend: () => backend,
      encryptString: (v) => Buffer.from(Buffer.from(v).map((n) => n ^ 42)),
      decryptString: (b) =>
        Buffer.from(b)
          .map((n) => n ^ 42)
          .toString(),
    }),
  }
}
const model = {
  repository: 'owner/gated',
  revision: 'a'.repeat(40),
  files: [{ path: 'one' }, { path: 'two' }],
} as ModelDefinition
it('refuses unavailable and plaintext secret backends', async () => {
  for (const [available, backend] of [
    [false, 'keychain'],
    [true, 'basic_text'],
  ] as const) {
    const { store } = await makeStore(available, backend)
    await expect(store.save('hf_secret')).rejects.toThrow('storage-unavailable')
  }
})
it('validates every required file, keeps token private, and revokes download authorization', async () => {
  const { store, path } = await makeStore()
  let calls = 0
  const access = new HuggingFaceAccessService(store, model, (async () => {
    calls++
    return new Response(null)
  }) as typeof fetch)
  const snapshot = await access.verify('hf_secret')
  expect(calls).toBe(2)
  expect(snapshot).toEqual({ status: 'granted', hasToken: true })
  expect((await readFile(path)).toString()).not.toContain('hf_secret')
  expect(JSON.stringify(snapshot)).not.toContain('hf_secret')
  expect(await access.downloadToken()).toBe('hf_secret')
  access.revoke()
  await expect(access.downloadToken()).rejects.toThrow('access-denied')
  await access.clear()
  expect(await store.read()).toBeNull()
})
it('distinguishes invalid credentials, gated access, and network failure without saving denied tokens', async () => {
  for (const [code, status] of [
    [401, 'invalid-token'],
    [403, 'access-denied'],
    [503, 'network-error'],
  ] as const) {
    const { store } = await makeStore()
    const access = new HuggingFaceAccessService(
      store,
      model,
      (async () => new Response(null, { status: code })) as typeof fetch,
    )
    expect((await access.verify('hf_private')).status).toBe(status)
    expect(await store.read()).toBeNull()
  }
})

it('serializes token deletion and a new explicit verification without resurrecting the old token', async () => {
  const { store } = await makeStore()
  let finishFirst!: () => void
  let first = true
  const access = new HuggingFaceAccessService(store, model, (async () => {
    if (first) {
      first = false
      await new Promise<void>((resolve) => {
        finishFirst = resolve
      })
    }
    return new Response(null)
  }) as typeof fetch)
  const oldVerification = access.verify('hf_old')
  const cleared = access.clear()
  const newVerification = access.verify('hf_new')
  await expect(access.downloadToken()).rejects.toThrow('access-denied')
  finishFirst()
  await oldVerification
  expect(await cleared).toEqual({ status: 'unchecked', hasToken: false })
  expect(await newVerification).toEqual({ status: 'granted', hasToken: true })
  expect(await store.read()).toBe('hf_new')
})

it('keeps local credential detection separate from model access verification', async () => {
  const { store } = await makeStore()
  const login = new LocalHuggingFaceLogin({ HF_TOKEN: 'hf_localtest' }, '/unused')
  let requests = 0
  const service = new HuggingFaceAccessService(
    store,
    model,
    (async () => {
      requests++
      return new Response(null)
    }) as typeof fetch,
    login,
  )
  expect(await service.detectLocal()).toEqual({ status: 'found' })
  expect(requests).toBe(0)
  expect(await store.read()).toBeNull()
  expect(await service.verifyLocal()).toEqual({ status: 'granted', hasToken: true })
  expect(requests).toBe(2)
  expect(await service.downloadToken()).toBe('hf_localtest')
  await service.clear()
  expect(await login.detect()).toEqual({ status: 'found' })
})
it('does not save locally discovered credentials when model permission is denied', async () => {
  const { store } = await makeStore()
  const service = new HuggingFaceAccessService(
    store,
    model,
    (async () => new Response(null, { status: 403 })) as typeof fetch,
    new LocalHuggingFaceLogin({ HF_TOKEN: 'hf_localtest' }),
  )
  expect((await service.verifyLocal()).status).toBe('access-denied')
  expect(await store.read()).toBeNull()
})
it('does not expose local-login operations without the development source', async () => {
  const { store } = await makeStore()
  const service = new HuggingFaceAccessService(store, model)
  expect(await service.detectLocal()).toEqual({ status: 'unsupported' })
  await expect(service.verifyLocal()).rejects.toThrow('local-login-unsupported')
})

it('verifies and saves long OAuth credentials from both local login and manual input', async () => {
  const token = 'hf_oauth_' + 'aB0-_'.repeat(160) + '.signature'
  for (const local of [true, false]) {
    const { store } = await makeStore()
    const service = new HuggingFaceAccessService(
      store,
      model,
      (async (_url, init) => {
        expect(new Headers(init?.headers).get('authorization')).toBe(`Bearer ${token}`)
        return new Response(null)
      }) as typeof fetch,
      new LocalHuggingFaceLogin({ HF_TOKEN: token }),
    )
    expect(await (local ? service.verifyLocal() : service.verify(token))).toEqual({
      status: 'granted',
      hasToken: true,
    })
    expect(await store.read()).toBe(token)
  }
})
it.each(['hf_bad\r\nInjected: value', 'hf_has space', 'hf_' + 'a'.repeat(16384)])(
  'rejects unsafe or oversized credentials before sending requests (%#)',
  async (token) => {
    const { store } = await makeStore()
    let requests = 0
    const service = new HuggingFaceAccessService(store, model, (async () => {
      requests++
      return new Response(null)
    }) as typeof fetch)
    expect((await service.verify(token)).status).toBe('invalid-token')
    expect(requests).toBe(0)
    expect(await store.read()).toBeNull()
  },
)
