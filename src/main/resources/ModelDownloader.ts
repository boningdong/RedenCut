import { mkdir, open, readFile, stat, writeFile, rm } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import type { ModelDefinition } from '../../shared/modelManifest.schema'
import { verifyModelFile, stagedModelFile } from './ModelRegistry'
function modelFileUrl(model: ModelDefinition, path: string): string {
  return `https://huggingface.co/${model.repository}/resolve/${model.revision}/${path.split('/').map(encodeURIComponent).join('/')}`
}
/** Redirects never forward the bearer credential to storage/CDN hosts. */
export async function fetchModel(
  url: string,
  init: RequestInit,
  fetcher: typeof fetch = fetch,
): Promise<Response> {
  let current = new URL(url)
  const headers = new Headers(init.headers)
  let linkedEtag: string | null = null
  for (let redirects = 0; redirects < 8; redirects++) {
    const response = await fetcher(current, { ...init, headers, redirect: 'manual' })
    if (redirects === 0) linkedEtag = response.headers.get('x-linked-etag')
    if (![301, 302, 303, 307, 308].includes(response.status)) {
      if (!linkedEtag) return response
      const responseHeaders = new Headers(response.headers)
      responseHeaders.set('x-linked-etag', linkedEtag)
      return new Response(response.body, {
        status: response.status,
        statusText: response.statusText,
        headers: responseHeaders,
      })
    }
    const location = response.headers.get('location')
    await response.body?.cancel()
    if (!location) throw new Error('network-error')
    const next = new URL(location, current)
    if (next.protocol !== 'https:') throw new Error('network-error')
    if (next.origin !== current.origin) headers.delete('authorization')
    current = next
  }
  throw new Error('network-error')
}
export class ModelDownloader {
  constructor(private readonly fetcher: typeof fetch = fetch) {}
  async download(
    model: ModelDefinition,
    staging: string,
    signal: AbortSignal,
    progress: (bytes: number) => void,
    token?: string,
    verifying?: () => void,
  ): Promise<void> {
    let completed = 0
    for (const file of model.files) {
      signal.throwIfAborted()
      const path = join(staging, file.path)
      let expected = await stagedModelFile(path, file)
      if (await verifyModelFile(path, expected)) {
        completed += file.size
        progress(completed)
        continue
      }
      await mkdir(dirname(path), { recursive: true })
      const url = modelFileUrl(model, file.path)
      const authorization = token ? { authorization: `Bearer ${token}` } : undefined
      const head = await fetchModel(
        url,
        { method: 'HEAD', headers: authorization, signal },
        this.fetcher,
      )
      if (!head.ok)
        throw new Error(
          head.status === 401 || head.status === 403 ? 'access-denied' : 'network-error',
        )
      const etag = head.headers.get('x-linked-etag') ?? head.headers.get('etag')
      if (file.requiresAuthenticatedSha256) {
        if (!token) throw new Error('access-denied')
        const sha256 = etag?.replace(/^"|"$/g, '')
        if (!sha256 || !/^[a-f0-9]{64}$/.test(sha256)) throw new Error('integrity-failed')
        expected = { ...file, sha256 }
        await writeFile(path + '.integrity.json', JSON.stringify({ sha256 }))
      }
      let offset = 0
      try {
        const record = JSON.parse(await readFile(path + '.download.json', 'utf8'))
        const size = (await stat(path)).size
        if (
          etag &&
          !etag.startsWith('W/') &&
          record.etag === etag &&
          record.revision === model.revision &&
          head.headers.get('accept-ranges') === 'bytes' &&
          size < file.size
        )
          offset = size
      } catch {
        /* Explicit restart when remote identity cannot be established. */
      }
      await writeFile(path + '.download.json', JSON.stringify({ revision: model.revision, etag }))
      const headers = new Headers(authorization)
      if (offset) {
        headers.set('range', `bytes=${offset}-`)
        headers.set('if-range', etag!)
      }
      let response = await fetchModel(url, { headers, signal }, this.fetcher)
      if (
        offset &&
        (response.status !== 206 ||
          response.headers.get('content-range') !== `bytes ${offset}-${file.size - 1}/${file.size}`)
      ) {
        await response.body?.cancel()
        offset = 0
        response = await fetchModel(url, { headers: authorization, signal }, this.fetcher)
      }
      if (!response.ok || !response.body)
        throw new Error(
          response.status === 401 || response.status === 403 ? 'access-denied' : 'network-error',
        )
      const handle = await open(path, offset ? 'a' : 'w')
      let received = offset
      progress(completed + received)
      try {
        for await (const chunk of response.body) {
          signal.throwIfAborted()
          if (received + chunk.length > file.size) throw new Error('integrity-failed')
          let written = 0
          while (written < chunk.length)
            written += (await handle.write(chunk, written, chunk.length - written)).bytesWritten
          received += chunk.length
          progress(completed + received)
        }
      } finally {
        await handle.close()
      }
      signal.throwIfAborted()
      verifying?.()
      if (!(await verifyModelFile(path, expected))) throw new Error('integrity-failed')
      await rm(path + '.download.json', { force: true })
      completed += file.size
    }
  }
}
