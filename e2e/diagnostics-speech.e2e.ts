import { join } from 'node:path'
import { afterEach, expect, test } from 'vitest'
import { DiagnosticBundleManifestSchema } from '../src/shared/DiagnosticBundleTypes'
import { unzip } from '../src/main/diagnostics/DiagnosticZipTestSupport'
import { McpTestSession } from './support/McpTestSession'

let session: McpTestSession | undefined

afterEach(async () => {
  await session?.close()
  session = undefined
})

test('typed alignment failure exposes a diagnostic report through the real UI', async () => {
  session = new McpTestSession()
  await session.start({ speechModels: true, alignmentFault: 'segment-mismatch' })
  await session.call('redencut_prepare_dialog', {
    request: {
      purpose: 'import-audio',
      selection: { type: 'file', filename: 'mandarin-short-female.wav' },
    },
  })
  await session.call('browser_click', { target: 'button:text-is("+ Add Track")' })
  await expect
    .poll(() => session!.page.locator('text=mandarin-short-female.wav').count(), {
      timeout: 40_000,
    })
    .toBeGreaterThan(0)
  await session.call('browser_click', { target: 'button:has-text("Generate")' })
  await session.call('browser_click', { target: 'button:text-is("Start processing")' })
  await expect
    .poll(() => session!.page.getByText('Analysis finished with issues').count(), {
      timeout: 150_000,
    })
    .toBeGreaterThan(0)
  const status = session.page.getByRole('status').filter({ hasText: 'Diagnostic ID' })
  await expect.poll(() => status.isVisible()).toBe(true)
  const displayed = await status.innerText()
  expect(displayed).toContain('Preliminary speech recognition finished')
  const diagnosticId = displayed.match(
    /Diagnostic ID:\s*([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/i,
  )?.[1]
  expect(diagnosticId).toBeTruthy()
  await session.call('browser_snapshot')
  await session.screenshot('alignment-failure')
  await session.call('browser_click', { target: 'button:text-is("Export diagnostic report")' })
  const preview = session.page.getByRole('button', { name: 'Inspect collected files' })
  await expect.poll(() => preview.isVisible()).toBe(true)
  expect(await session.page.locator('.diagnostic-collection').innerText()).toContain(diagnosticId)
  await expect
    .poll(() =>
      session!.page.getByText(/Audio, transcript text and project files are excluded/).isVisible(),
    )
    .toBe(true)
  await session.call('browser_snapshot')
  await session.screenshot('report-preview')
  await session.call('redencut_prepare_dialog', {
    request: { purpose: 'diagnostic-report', selection: { type: 'cancel' } },
  })
  await session.call('browser_click', { target: 'button:text-is("Save diagnostic bundle…")' })
  await expect.poll(() => preview.isVisible()).toBe(true)
  await session.call('redencut_prepare_dialog', {
    request: {
      purpose: 'diagnostic-report',
      selection: { type: 'report', filename: 'alignment-diagnostics.zip' },
    },
  })
  await session.call('browser_click', { target: 'button:text-is("Save diagnostic bundle…")' })
  await expect
    .poll(() => session!.page.getByRole('button', { name: 'Show in Finder' }).isVisible())
    .toBe(true)
  const files = await unzip(join(session.directory, 'reports', 'alignment-diagnostics.zip'))
  const report = DiagnosticBundleManifestSchema.parse(JSON.parse(files['manifest.json']))
  const saved = Object.values(files).join('\n')
  expect(report.diagnosticIds).toContain(diagnosticId)
  expect(saved).toContain('operation/failed')
  expect(saved).not.toContain('mandarin-short-female.wav')
  expect(saved).not.toContain('今天下午')
  await session.screenshot('report-saved')
  await session.call('browser_click', { target: 'dialog button:text-is("Close")' })
  await session.call('browser_click', { target: 'button[aria-label="Settings"]' })
  await session.call('browser_select_option', { target: 'dialog select', values: ['zh-CN'] })
  await session.call('browser_click', { target: 'dialog button[aria-label="关闭"]' })
  await expect.poll(() => session!.page.locator('html').getAttribute('lang')).toBe('zh-CN')
  const translated = await session.page
    .getByRole('status')
    .filter({ hasText: '诊断编号' })
    .innerText()
  expect(translated).toContain(
    '初步文字识别已完成，但识别出的文字和时间片段无法对应，暂时不能把文字准确定位到音频。',
  )
  expect(translated).toContain(diagnosticId)
  await session.screenshot('alignment-failure-chinese')
}, 180_000)

test('two failed sources keep distinct IDs and one combined report', async () => {
  session = new McpTestSession()
  await session.start({ speechModels: true, alignmentFault: 'segment-mismatch' })
  for (const [index, filename] of [
    'mandarin-short-female.wav',
    'mandarin-short-female.m4a',
  ].entries()) {
    await session.call('redencut_prepare_dialog', {
      request: { purpose: 'import-audio', selection: { type: 'file', filename } },
    })
    await session.call('browser_click', { target: 'button:text-is("+ Add Track")' })
    await expect
      .poll(() => session!.page.locator('.waveform-clip canvas').count(), { timeout: 40_000 })
      .toBe(index + 1)
  }
  await session.call('browser_click', { target: 'button:has-text("Generate")' })
  await session.call('browser_click', { target: 'button:text-is("Start processing")' })
  await expect
    .poll(
      () => session!.page.getByRole('button', { name: 'Export all failed sources' }).isVisible(),
      {
        timeout: 220_000,
      },
    )
    .toBe(true)
  const summary = await session.page
    .getByRole('status')
    .filter({ hasText: 'Diagnostic ID' })
    .innerText()
  const ids = [...summary.matchAll(/Diagnostic ID:\s*([0-9a-f-]{36})/gi)].map((match) => match[1])
  expect(ids).toHaveLength(2)
  expect(new Set(ids).size).toBe(2)
  await session.call('browser_snapshot')
  await session.screenshot('batch-two-failures')
  await session.call('browser_click', { target: 'button:text-is("Export all failed sources")' })
  const preview = session.page.getByRole('button', { name: 'Inspect collected files' })
  await expect.poll(() => preview.isVisible()).toBe(true)
  const summaryText = await session.page.locator('.diagnostic-collection').innerText()
  for (const id of ids) expect(summaryText).toContain(id)
  await session.screenshot('batch-combined-report')
}, 240_000)
