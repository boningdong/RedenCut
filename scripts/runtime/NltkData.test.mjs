import assert from 'node:assert/strict'
import test from 'node:test'
import { mkdtemp, mkdir, readFile, rm } from 'node:fs/promises'
import { createWriteStream } from 'node:fs'
import { pipeline } from 'node:stream/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import yazl from 'yazl'
import { stageNltkData } from './NltkData.mjs'
import { sha256File } from './RuntimeIntegrity.mjs'

test('stages English tables and provenance while rejecting an incomplete or altered archive', async () => {
  const root = await mkdtemp(join(tmpdir(), 'redencut-nltk-stage-'))
  try {
    const archive = join(root, 'data.zip')
    const zip = new yazl.ZipFile()
    for (const name of [
      'abbrev_types.txt',
      'collocations.tab',
      'ortho_context.tab',
      'sent_starters.txt',
    ])
      zip.addBuffer(Buffer.from('bundled'), `punkt_tab/english/${name}`)
    zip.addBuffer(Buffer.from('upstream attribution'), 'punkt_tab/README')
    zip.end()
    await pipeline(zip.outputStream, createWriteStream(archive))
    const source = { sha256: await sha256File(archive) }
    const runtime = join(root, 'runtime')
    await mkdir(runtime)
    await stageNltkData(archive, runtime, source)
    assert.equal(
      await readFile(
        join(runtime, 'nltk_data/tokenizers/punkt_tab/english/ortho_context.tab'),
        'utf8',
      ),
      'bundled',
    )
    assert.equal(
      await readFile(join(runtime, 'nltk_data/tokenizers/punkt_tab/README'), 'utf8'),
      'upstream attribution',
    )
    await assert.rejects(stageNltkData(archive, runtime, { sha256: '0'.repeat(64) }), /checksum/i)
    const broken = join(root, 'broken.zip')
    const partial = new yazl.ZipFile()
    partial.addBuffer(Buffer.from('one'), 'punkt_tab/english/abbrev_types.txt')
    partial.end()
    await pipeline(partial.outputStream, createWriteStream(broken))
    await assert.rejects(
      stageNltkData(broken, runtime, { sha256: await sha256File(broken) }),
      /missing/i,
    )
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})
