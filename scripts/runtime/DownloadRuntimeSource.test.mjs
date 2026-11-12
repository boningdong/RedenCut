import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { downloadRuntimeSource } from './DownloadRuntimeSource.mjs'

function source(contents) {
  return {
    archive: 'source.tar',
    url: `data:application/octet-stream;base64,${Buffer.from(contents).toString('base64')}`,
    sha256: createHash('sha256').update(contents).digest('hex'),
  }
}

test('downloads verified bytes and rejects corrupt cached files', async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'runtime-download-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  const definition = source('locked contents')
  const path = await downloadRuntimeSource(definition, root)
  assert.equal(await readFile(path, 'utf8'), 'locked contents')
  assert.equal(await downloadRuntimeSource(definition, root), path)
  await writeFile(path, 'corrupt')
  await assert.rejects(downloadRuntimeSource(definition, root), /Cached source hash mismatch/)
})

test('rejects altered downloads and removes incomplete download files', async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'runtime-download-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  const definition = { ...source('expected'), url: source('altered').url }
  await assert.rejects(downloadRuntimeSource(definition, root), /Downloaded source hash mismatch/)
  assert.deepEqual(await readdir(root), [])
})
