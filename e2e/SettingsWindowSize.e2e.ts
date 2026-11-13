import { expect, test } from 'vitest'
import { McpTestSession } from './support/McpTestSession'

test.each(['en', 'zh-CN'] as const)(
  'Settings keeps its layout across languages, tabs and Diagnostics collection in %s',
  async (locale) => {
    const ui = new McpTestSession()
    try {
      await ui.start()
      await ui.call('browser_click', { target: 'button[aria-label="Settings"]' })
      await ui.call('browser_select_option', { target: 'dialog select', values: [locale] })
      await expect.poll(() => ui.page.locator('html').getAttribute('lang')).toBe(locale)

      const dialog = ui.page.locator('dialog.settings[open]')
      const scroll = dialog.locator('.settings-scroll')
      const heading = dialog.locator('.modal-heading')
      const navigation = dialog.locator('.settings-nav')
      const main = dialog.locator('.settings-main')
      for (const viewport of [
        { width: 1280, height: 900 },
        { width: 900, height: 600 },
      ]) {
        await ui.call('browser_resize', viewport)
        await ui.call('browser_click', { target: 'dialog button[data-value="general"]' })
        const baseline = await dialog.boundingBox()
        expect(baseline).not.toBeNull()
        const viewportHeight = await ui.page.evaluate(() => window.innerHeight)
        expect(baseline!.height).toBe(Math.min(680, viewportHeight - 40))
        expect(baseline!.width).toBe(780)
        const menuBaseline = await navigation.boundingBox()
        const mainBaseline = await main.boundingBox()
        const contentBaseline = await scroll.boundingBox()
        expect(menuBaseline!.width).toBe(220)
        expect(mainBaseline!.x).toBe(menuBaseline!.x + menuBaseline!.width)

        const assertLayout = async () => {
          const bounds = await dialog.boundingBox()
          expect(bounds!.height).toBe(baseline!.height)
          expect(bounds!.y).toBe(baseline!.y)
          expect(bounds).toEqual(baseline)
          expect(await navigation.boundingBox()).toEqual(menuBaseline)
          expect((await main.boundingBox())!.x).toBe(mainBaseline!.x)
          expect((await scroll.boundingBox())!.x).toBe(contentBaseline!.x)
          for (const region of [dialog, main, scroll, navigation]) {
            expect(
              await region.evaluate((element) => element.scrollWidth <= element.clientWidth),
            ).toBe(true)
          }
          const headingBounds = await heading.boundingBox()
          expect(headingBounds!.y).toBeGreaterThanOrEqual(bounds!.y)
          expect(headingBounds!.y + headingBounds!.height).toBeLessThanOrEqual(
            bounds!.y + bounds!.height,
          )
          expect(await heading.locator('button').isVisible()).toBe(true)
          expect(await navigation.locator('button:visible').count()).toBe(4)
          expect(
            await navigation.locator('button').evaluateAll((buttons) =>
              buttons.every((button) => {
                const bounds = button.getBoundingClientRect()
                const label = document.createRange()
                label.selectNodeContents(button)
                const labelBounds = label.getBoundingClientRect()
                return (
                  button.scrollWidth <= button.clientWidth &&
                  labelBounds.left >= bounds.left &&
                  labelBounds.right <= bounds.right &&
                  labelBounds.top >= bounds.top &&
                  labelBounds.bottom <= bounds.bottom
                )
              }),
            ),
          ).toBe(true)
          expect(await scroll.evaluate((element) => getComputedStyle(element).overflowY)).toBe(
            'auto',
          )
        }

        for (const language of ['en', 'zh-CN', 'en']) {
          await ui.call('browser_click', { target: 'dialog button[data-value="general"]' })
          await ui.call('browser_select_option', { target: 'dialog select', values: [language] })
          await expect.poll(() => ui.page.locator('html').getAttribute('lang')).toBe(language)
          await assertLayout()
          for (const tab of ['theme', 'resources', 'diagnostics', 'general']) {
            await ui.call('browser_click', { target: `dialog button[data-value="${tab}"]` })
            await assertLayout()
          }
        }

        await ui.call('browser_select_option', { target: 'dialog select', values: [locale] })
        await expect.poll(() => ui.page.locator('html').getAttribute('lang')).toBe(locale)
        await ui.call('browser_click', { target: 'dialog button[data-value="diagnostics"]' })
        await assertLayout()
        await ui.call('browser_click', { target: '.diagnostic-actions button.primary' })
        await ui.page.locator('.diagnostic-result').waitFor({ state: 'visible' })
        await assertLayout()
        await ui.call('browser_click', { target: '.diagnostic-files summary' })
        await ui.call('browser_click', { target: '.diagnostic-privacy summary' })
        await assertLayout()
        const fixedHeading = await heading.boundingBox()
        const fixedNavigation = await navigation.boundingBox()
        const scrollGeometry = await scroll.evaluate((element) => ({
          scrollHeight: element.scrollHeight,
          clientHeight: element.clientHeight,
        }))
        // Tab from the privacy disclosure to Review files: native keyboard scrolling
        // must reveal the action without moving the heading or navigation.
        await ui.call('browser_press_key', { key: 'Tab' })
        const review = dialog.locator('.diagnostic-actions > button')
        await expect
          .poll(() => review.evaluate((element) => element === document.activeElement))
          .toBe(true)
        await expect
          .poll(async () => {
            const actionBounds = await review.boundingBox()
            const scrollBounds = await scroll.boundingBox()
            return (
              actionBounds !== null &&
              scrollBounds !== null &&
              actionBounds.y >= scrollBounds.y &&
              actionBounds.y + actionBounds.height <= scrollBounds.y + scrollBounds.height
            )
          })
          .toBe(true)
        if (scrollGeometry.scrollHeight > scrollGeometry.clientHeight) {
          await expect
            .poll(() => scroll.evaluate((element) => element.scrollTop))
            .toBeGreaterThan(0)
        }
        expect(await heading.boundingBox()).toEqual(fixedHeading)
        expect(await navigation.boundingBox()).toEqual(fixedNavigation)
        await assertLayout()
        await ui.screenshot(`settings-${locale}-${viewport.width}x${viewport.height}`)
      }
      await ui.call('browser_click', { target: 'dialog .modal-heading button' })
      expect(await dialog.count()).toBe(0)
    } finally {
      await ui.close()
    }
  },
)
