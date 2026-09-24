import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterEach, expect, test } from 'vitest'
import { DiagnosticReportSchema } from '../src/shared/diagnostics.types'
import { McpTestSession } from './support/McpTestSession'

let session: McpTestSession | undefined

afterEach(async () => {
  await session?.close()
  session = undefined
})

test('missing speech setup explains the prerequisite and opens Settings', async () => {
  session = new McpTestSession()
  await session.start()
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
  await session.call('browser_snapshot')
  await session.screenshot('before-speech-start')
  await session.call('browser_click', { target: 'button:text-is("Start processing")' })
  await expect
    .poll(async () => session!.page.getByRole('alert').allInnerTexts(), { timeout: 40_000 })
    .toEqual(expect.arrayContaining([expect.stringMatching(/speech|model|runtime/i)]))
  await session.call('browser_snapshot')
  await session.screenshot('speech-setup-failure')
  await session.call('browser_click', { target: 'button:text-is("Open Settings")' })
  await expect
    .poll(() => session!.page.getByRole('dialog').allInnerTexts())
    .toEqual(expect.arrayContaining([expect.stringMatching(/Models|dependencies/i)]))
  await session.call('browser_snapshot')
  await session.screenshot('speech-setup-settings')
}, 90_000)

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
  const preview = session.page.locator('pre[aria-label="Report preview"]')
  await expect.poll(() => preview.isVisible()).toBe(true)
  const content = await preview.textContent()
  expect(content).toContain(diagnosticId)
  await expect
    .poll(() =>
      session!.page
        .getByText(/Audio, transcript text, project files and tokens are excluded/)
        .isVisible(),
    )
    .toBe(true)
  await session.call('browser_snapshot')
  await session.screenshot('report-preview')
  await session.call('redencut_prepare_dialog', {
    request: { purpose: 'diagnostic-report', selection: { type: 'cancel' } },
  })
  await session.call('browser_click', { target: 'button:text-is("Save report…")' })
  await expect.poll(() => preview.isVisible()).toBe(true)
  await session.call('redencut_prepare_dialog', {
    request: {
      purpose: 'diagnostic-report',
      selection: { type: 'report', filename: 'alignment-diagnostics.json' },
    },
  })
  await session.call('browser_click', { target: 'button:text-is("Save report…")' })
  await expect
    .poll(() => session!.page.getByRole('button', { name: 'Show in Finder' }).isVisible())
    .toBe(true)
  const saved = readFileSync(
    join(session.directory, 'reports', 'alignment-diagnostics.json'),
    'utf8',
  )
  expect(saved).toBe(content)
  const report = DiagnosticReportSchema.parse(JSON.parse(saved))
  expect(report.diagnosticIds).toContain(diagnosticId)
  expect(report.events.some((event) => event.event === 'operation/failed')).toBe(true)
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
  const preview = session.page.locator('pre[aria-label="Report preview"]')
  await expect.poll(() => preview.isVisible()).toBe(true)
  const report = DiagnosticReportSchema.parse(JSON.parse((await preview.textContent())!))
  expect(report.diagnosticIds).toEqual(ids)
  expect(report.events.filter((event) => event.event === 'operation/failed')).toHaveLength(2)
  await session.screenshot('batch-combined-report')
}, 240_000)
