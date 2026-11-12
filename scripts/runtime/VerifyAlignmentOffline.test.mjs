import assert from 'node:assert/strict'
import test from 'node:test'
import { access, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { verifyAlignmentOffline } from './VerifyAlignmentOffline.mjs'

for (const fails of [false, true]) {
  test(`offline alignment runner cleans its temporary directory after ${fails ? 'failure' : 'success'}`, async (t) => {
    const root = await mkdtemp(join(tmpdir(), 'redencut-alignment-runner-'))
    t.after(() => rm(root, { recursive: true, force: true }))
    const runtimeRoot = join(root, 'runtime')
    const recordPath = join(root, 'process.json')
    await mkdir(runtimeRoot)
    await writeFile(
      join(runtimeRoot, 'manifest.json'),
      JSON.stringify({ executables: { python: 'python' } }),
    )
    await writeFile(
      join(runtimeRoot, 'python'),
      `#!${process.execPath}
const fs = require('node:fs')
fs.writeFileSync(${JSON.stringify(recordPath)}, JSON.stringify({cwd: process.cwd(), nltkData: process.env.NLTK_DATA, home: fs.realpathSync(process.env.HOME)}))
${fails ? 'process.exit(3)' : 'console.log(JSON.stringify({en: {segments: 1, characters: 11}, zh: {segments: 1, characters: 4}}))'}
`,
      { mode: 0o755 },
    )
    const operation = verifyAlignmentOffline(runtimeRoot, join(root, 'models'))
    if (fails) await assert.rejects(operation, { code: 3 })
    else
      assert.deepEqual(await operation, {
        en: { segments: 1, characters: 11 },
        zh: { segments: 1, characters: 4 },
      })
    const record = JSON.parse(await readFile(recordPath, 'utf8'))
    assert.equal(record.home, record.cwd)
    assert.equal(record.nltkData, join(runtimeRoot, 'nltk_data'))
    await assert.rejects(access(record.cwd), { code: 'ENOENT' })
  })
}
