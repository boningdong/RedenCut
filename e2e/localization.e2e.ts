import { expect, test } from 'vitest'
import { McpTestSession } from './support/McpTestSession'

// Interaction goes through MCP; DOM reads assert only visible UI and selected controls.
test('language switches preserve imported audio and survive an application restart', async () => {
  const ui = new McpTestSession()
  try {
    await ui.start()
    await expect.poll(() => ui.page.getByRole('combobox').count()).toBe(1)
    await ui.call('browser_select_option', { target: 'select', values: ['en'] })
    await expect
      .poll(() => ui.page.getByRole('button', { name: 'Open Project', exact: true }).count())
      .toBe(1)
    await ui.call('redencut_prepare_dialog', {
      request: {
        purpose: 'import-audio',
        selection: { type: 'file', filename: 'mandarin-short-female.wav' },
      },
    })
    await ui.call('browser_click', { target: 'button:text-is("+ Add Track")' })
    await expect
      .poll(() => ui.page.locator('.waveform-clip canvas').count(), { timeout: 40_000 })
      .toBe(1)
    await expect
      .poll(() => ui.page.locator('[data-redencut-busy]').getAttribute('data-redencut-busy'))
      .toBe('false')
    await ui.call('browser_select_option', { target: 'select', values: ['zh-CN'] })
    await expect.poll(() => ui.page.locator('html').getAttribute('lang')).toBe('zh-CN')
    await expect
      .poll(() => ui.page.getByRole('button', { name: '保存', exact: true }).count())
      .toBe(1)
    expect(await ui.page.locator('.waveform-clip canvas').count()).toBe(1)
    await ui.screenshot('chinese-imported')
    await ui.call('redencut_prepare_dialog', {
      request: {
        purpose: 'save-project',
        selection: { type: 'project', name: 'localized-audio.redencut' },
      },
    })
    await ui.call('browser_click', { target: 'button:text-is("保存")' })
    await expect
      .poll(() => ui.page.locator('[data-redencut-dirty]').getAttribute('data-redencut-dirty'))
      .toBe('false')
    await ui.restart()
    await expect.poll(() => ui.page.locator('html').getAttribute('lang')).toBe('zh-CN')
    expect(await ui.page.getByRole('combobox').inputValue()).toBe('zh-CN')
    await ui.screenshot('chinese-restarted')
    await ui.call('browser_select_option', { target: 'select', values: ['en'] })
    await expect
      .poll(() => ui.page.getByRole('button', { name: 'Open Project', exact: true }).count())
      .toBe(1)
    await ui.call('redencut_prepare_dialog', {
      request: {
        purpose: 'open-project',
        selection: { type: 'project', name: 'localized-audio.redencut' },
      },
    })
    await ui.call('browser_click', { target: 'button:text-is("Open Project")' })
    await expect
      .poll(() => ui.page.locator('.waveform-clip canvas').count(), { timeout: 40_000 })
      .toBe(1)
    await ui.screenshot('english-reopened')
  } finally {
    await ui.close()
  }
})
