import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, expect, it } from 'vitest'
import { HelperLogCollector } from './HelperLogCollector'
import { AppLogger } from '../logging/AppLogger'
import { RotatingLogWriter } from '../logging/RotatingLogWriter'
const roots: string[] = []
afterEach(async () => {
  await Promise.all(roots.splice(0).map((p) => rm(p, { recursive: true, force: true })))
})
async function setup(format: 'python' | 'text' = 'python') {
  const root = await mkdtemp(join(tmpdir(), 'helper-logs-'))
  roots.push(root)
  const writer = await RotatingLogWriter.create(root)
  const logger = new AppLogger(writer).withContext({ source: 'python' })
  return { writer, root, collector: new HelperLogCollector(logger, format) }
}
it('reassembles UTF-8, honors Python severity and keeps final unterminated output', async () => {
  const { writer, root, collector } = await setup()
  const data = Buffer.from(
    '你好\n{"type":"log","version":1,"level":"warn","logger":"worker","message":"use fallback"}\nlast line',
  )
  collector.write(data.subarray(0, 2))
  collector.write(data.subarray(2, 15))
  collector.write(data.subarray(15))
  collector.finish()
  await writer.flush()
  const records = (await readFile(join(root, 'runtime.jsonl'), 'utf8'))
    .trim()
    .split('\n')
    .map((s) => JSON.parse(s))
  expect(records.map((r) => r.message)).toEqual(['你好', 'use fallback', 'last line'])
  expect(records[1].level).toBe('warn')
  await writer.dispose()
})
it('bounds huge partial lines and recovers at the next newline', async () => {
  const { writer, root, collector } = await setup('text')
  for (let i = 0; i < 100; i++) collector.write(Buffer.alloc(10000, 120))
  collector.write('\nnext message\n')
  collector.finish()
  await writer.flush()
  const text = await readFile(join(root, 'runtime.jsonl'), 'utf8')
  expect(Buffer.byteLength(text)).toBeLessThan(40000)
  expect(text).toContain('next message')
  expect(text).toContain('"truncated":true')
  await writer.dispose()
})
it('collapses carriage-return progress but keeps adjacent warnings', async () => {
  const { writer, root, collector } = await setup('text')
  collector.write('progress = 1%\rprogress = 2%\rprogress = 3%\r\nwarning: allocation slow\n')
  collector.finish()
  await writer.flush()
  const text = await readFile(join(root, 'runtime.jsonl'), 'utf8')
  expect(text).not.toContain('progress = 1%')
  expect(text).toContain('progress = 3%')
  expect(text).toContain('allocation slow')
  await writer.dispose()
})
