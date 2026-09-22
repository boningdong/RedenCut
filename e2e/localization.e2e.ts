import { expect, test } from 'vitest'
import { McpTestSession } from './support/McpTestSession'

// Interaction goes through MCP; DOM reads assert only visible UI and selected controls.
test('language switches preserve imported audio and survive an application restart', async () => {
  const ui = new McpTestSession()
  const checkSidebar = async (label: string, screenshot: string) => {
    expect(await ui.page.getByRole('button', { name: label, exact: true }).count()).toBe(1)
    await expect
      .poll(() =>
        ui.page.locator('.settings-nav').evaluate((nav) => {
          const right = nav.getBoundingClientRect().right
          return Array.from(nav.querySelectorAll('button')).every(
            (button) =>
              button.scrollWidth <= button.clientWidth &&
              button.getBoundingClientRect().right <= right - 12,
          )
        }),
      )
      .toBe(true)
    await ui.screenshot(screenshot)
  }

  try {
    await ui.start()
    await ui.call('browser_click', { target: 'button[aria-label="Settings"]' })
    await expect.poll(() => ui.page.getByRole('combobox').count()).toBe(1)
    await ui.call('browser_select_option', { target: 'select', values: ['en'] })
    await checkSidebar('Models & dependencies', 'settings-sidebar-english')
    await ui.call('browser_click', { target: 'dialog button[aria-label="Close"]' })
    await expect
      .poll(() => ui.page.getByRole('button', { name: 'Save', exact: true }).count())
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
    await ui.call('browser_click', { target: 'button[aria-label="Settings"]' })
    await ui.call('browser_select_option', { target: 'dialog select', values: ['zh-CN'] })
    await checkSidebar('模型与依赖', 'settings-sidebar-chinese')
    await ui.call('browser_click', { target: 'dialog button[aria-label="关闭"]' })
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
    await ui.call('browser_click', { target: 'button[aria-label="设置"]' })
    expect(await ui.page.getByRole('combobox').inputValue()).toBe('zh-CN')
    await ui.screenshot('chinese-restarted')
    await ui.call('browser_select_option', { target: 'select', values: ['en'] })
    await ui.call('browser_click', { target: 'dialog button[aria-label="Close"]' })
    await expect
      .poll(() => ui.page.getByRole('button', { name: 'Save', exact: true }).count())
      .toBe(1)
    await ui.call('redencut_prepare_dialog', {
      request: {
        purpose: 'open-project',
        selection: { type: 'project', name: 'localized-audio.redencut' },
      },
    })
    await ui.call('browser_click', { target: '.project-name' })
    await ui.call('browser_click', { target: 'button:text-is("Open Project")' })
    await expect
      .poll(() => ui.page.locator('.waveform-clip canvas').count(), { timeout: 40_000 })
      .toBe(1)
    await ui.screenshot('english-reopened')
  } finally {
    await ui.close()
  }
})
