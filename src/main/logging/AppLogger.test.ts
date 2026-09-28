import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { createHash } from 'node:crypto'
import { afterEach, expect, it } from 'vitest'
import { AppLogger } from './AppLogger'
import { RotatingLogWriter } from './RotatingLogWriter'

const roots: string[] = []
afterEach(async () => {
  await Promise.all(roots.splice(0).map((p) => rm(p, { recursive: true, force: true })))
})
async function setup(options = {}) {
  const root = await mkdtemp(join(tmpdir(), 'app-logs-'))
  roots.push(root)
  const writer = await RotatingLogWriter.create(root, options)
  return {
    root,
    writer,
    logger: new AppLogger(writer, { home: '/Users/alice', secrets: ['private-token'] }),
  }
}
async function contents(root: string) {
  return (
    await Promise.all(
      (await readdir(root))
        .filter((p) => p.endsWith('.jsonl'))
        .sort()
        .map((p) => readFile(join(root, p), 'utf8')),
    )
  ).join('')
}
it('persists sanitized messages and stack, preserving operation correlation without invoking getters', async () => {
  const { root, writer, logger } = await setup()
  const scoped = logger.withContext({
    source: 'python',
    operationId: 'private-job',
    component: 'speech',
  })
  const error = new Error('Failed /Users/alice/recording.wav token=private-token')
  Object.defineProperty(error, 'cause', {
    get() {
      throw new Error('getter invoked')
    },
  })
  scoped.error('Speech failed', error)
  await writer.flush()
  const text = await contents(root)
  expect(text).toContain('Speech failed')
  expect(text).toContain('Error: Failed')
  expect(text).not.toContain('private-token')
  expect(text).not.toContain('/Users/alice')
  expect(JSON.parse(text).operationId).toBe(
    createHash('sha256').update('private-job').digest('hex').slice(0, 32),
  )
  expect(JSON.parse(text).source).toBe('python')
  await writer.dispose()
})
it('keeps a frozen snapshot across later rotation and bounds file count', async () => {
  const { root, writer, logger } = await setup({ maxFileBytes: 800, maxFiles: 2 })
  logger.info('before snapshot')
  await writer.flush()
  const dest = join(root, 'snapshot')
  await writer.snapshot(dest)
  for (let i = 0; i < 80; i++) logger.info('later ' + i)
  await writer.flush()
  expect(await contents(dest)).toContain('before snapshot')
  expect(await contents(dest)).not.toContain('later')
  expect((await readdir(root)).filter((p) => p.endsWith('.jsonl')).length).toBeLessThanOrEqual(2)
  for (const name of (await readdir(root)).filter((p) => p.endsWith('.jsonl')))
    expect((await readFile(join(root, name))).length).toBeLessThanOrEqual(800)
  await writer.dispose()
})
it('caps queue growth during saturation, retains warnings and accounts for dropped info', async () => {
  const { root, writer, logger } = await setup({
    maxQueueBytes: 2000,
    priorityReserveBytes: 1000,
    batchBytes: 100000,
  })
  for (let i = 0; i < 100; i++) logger.info('noisy ' + i)
  logger.warn('important warning')
  expect(writer.pendingBytes).toBeLessThanOrEqual(2000)
  await writer.flush()
  const text = await contents(root)
  expect(text).toContain('important warning')
  expect(writer.losses.droppedRecords.info).toBeGreaterThan(0)
  expect(text).toContain('logging/loss')
  await writer.dispose()
})
it('truncates a huge escaped record to its serialized byte limit', async () => {
  const { root, writer, logger } = await setup()
  logger.error('"😀'.repeat(50000), new Error('x'.repeat(100000)))
  await writer.flush()
  const text = await contents(root)
  for (const line of text.trim().split('\n'))
    expect(Buffer.byteLength(line) + 1).toBeLessThanOrEqual(16384)
  expect(text).toContain('"truncated":true')
  await writer.dispose()
})

it('keeps total queued and in-flight bytes bounded during slow and failed writes', async () => {
  let unblock!: () => void
  const gate = new Promise<void>((resolve) => {
    unblock = resolve
  })
  const { writer, logger } = await setup({
    maxQueueBytes: 4000,
    priorityReserveBytes: 1000,
    batchBytes: 200,
    append: async () => {
      await gate
      throw new Error('disk failure')
    },
  })
  for (let i = 0; i < 1000; i++) logger.info('noisy helper message ' + i)
  logger.warn('important warning')
  expect(writer.pendingBytes).toBeLessThanOrEqual(4000)
  expect(writer.losses.droppedRecords.info).toBeGreaterThan(0)
  unblock()
  await writer.flush()
  expect(writer.losses.writeFailures).toBeGreaterThan(0)
  expect(writer.losses.countersComplete).toBe(false)
  expect(writer.pendingBytes).toBe(0)
  await writer.dispose()
})

it('can rotate after an age-prune removes the previously active file', async () => {
  const { root, writer, logger } = await setup({ maxAgeDays: 1, maxFileBytes: 800, maxFiles: 2 })
  logger.info('old retained message' + 'x'.repeat(480))
  await writer.flush()
  const { utimes } = await import('node:fs/promises')
  const old = new Date(Date.now() - 2 * 86400000)
  await utimes(join(root, 'runtime.jsonl'), old, old)
  // Pruning is scheduled, not performed per message.
  const { vi } = await import('vitest')
  const now = Date.now()
  const clock = vi.spyOn(Date, 'now').mockReturnValue(now + 61_000)
  try {
    for (let i = 0; i < 15; i++) logger.info('new message ' + i + 'x'.repeat(480))
    await writer.flush()
    expect(writer.losses.writeFailures).toBe(0)
    expect(await contents(root)).toContain('new message 14')
  } finally {
    clock.mockRestore()
    await writer.dispose()
  }
})

it('never invokes a bound custom stack getter and sanitizes helper component names', async () => {
  const { root, writer, logger } = await setup()
  let invoked = false
  const error = new Error('safe error')
  Object.defineProperty(error, 'stack', {
    get: (() => {
      invoked = true
      return 'unsafe getter result'
    }).bind(null),
  })
  logger.withContext({ source: 'python', component: 'token=private-token' }).error('test', error)
  await writer.flush()
  expect(invoked).toBe(false)
  expect(await contents(root)).not.toContain('private-token')
  await writer.dispose()
})
