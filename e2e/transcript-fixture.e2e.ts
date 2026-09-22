import { cpSync, mkdirSync } from 'node:fs'
import { resolve, join } from 'node:path'
import { expect, test } from 'vitest'
import { McpTestSession } from './support/McpTestSession'

test.each(['transcript-editing-high-precision.redencut', 'transcript-editing.redencut'])(
  'saved transcript %s supports editing and restart without models',
  async (name) => {
    const ui = new McpTestSession()
    try {
      await ui.start()
      mkdirSync(join(ui.directory, 'projects'), { recursive: true })
      cpSync(resolve('e2e/fixtures/projects', name), join(ui.directory, 'projects', name), {
        recursive: true,
        errorOnExist: true,
        force: false,
      })
      const open = async () => {
        await ui.call('redencut_prepare_dialog', {
          request: { purpose: 'open-project', selection: { type: 'project', name } },
        })
        await ui.call('browser_click', { target: '.project-name' })
        await ui.call('browser_click', { target: 'button:text-is("Open Project")' })
        await expect
          .poll(() => ui.page.locator('[data-acoustic-editable="true"]').count(), {
            timeout: 40_000,
          })
          .toBeGreaterThan(100)
        await expect
          .poll(() => ui.page.locator('.waveform-clip canvas').count(), { timeout: 40_000 })
          .toBeGreaterThan(0)
      }
      await open()
      const clipCount = await ui.page.locator('.waveform-clip').count()
      await ui.screenshot('transcript-fixture-open')
      const speech = ui.page.locator('[data-unit-kind="speech"][data-acoustic-editable="true"]')
      const firstId = await speech.first().getAttribute('data-unit-id')
      const first = await speech.first().boundingBox()
      const sixth = await speech.nth(5).boundingBox()
      if (!first || !sixth || !firstId) throw new Error('TRANSCRIPT_GEOMETRY_MISSING')
      await ui.call('browser_mouse_drag_xy', {
        startX: first.x + 1,
        startY: first.y + first.height / 2,
        endX: sixth.x + sixth.width - 1,
        endY: sixth.y + sixth.height / 2,
      })
      await ui.screenshot('transcript-fixture-selection')
      await ui.call('browser_press_key', { key: 'Delete' })
      const strike = () =>
        ui.page
          .locator(`[data-unit-id="${firstId}"]`)
          .first()
          .evaluate((node) => getComputedStyle(node).textDecorationLine)
      await expect.poll(strike).toContain('line-through')
      expect(await ui.page.locator('.waveform-clip').count()).toBe(clipCount)
      expect(await ui.page.locator('.clip-redaction').count()).toBe(1)
      await ui.screenshot('transcript-fixture-redacted')
      await ui.call('browser_press_key', { key: 'Control+z' })
      await expect.poll(strike).not.toContain('line-through')
      await ui.call('browser_press_key', { key: 'Control+Shift+z' })
      await expect.poll(strike).toContain('line-through')
      const overlay = ui.page.locator('.clip-redaction').first()
      const originalEnd = Number(await overlay.getAttribute('data-source-end'))
      const handle = await overlay
        .getByRole('button', { name: 'Adjust redaction end' })
        .boundingBox()
      if (!handle) throw new Error('REDACTION_HANDLE_MISSING')
      await ui.call('browser_mouse_move_xy', {
        x: handle.x + handle.width / 2,
        y: handle.y + handle.height / 2,
      })
      await ui.call('browser_mouse_down')
      await ui.call('browser_mouse_move_xy', {
        x: handle.x + handle.width / 2 + 12,
        y: handle.y + handle.height / 2,
      })
      const outlines = () =>
        overlay.evaluate((node) =>
          [node, ...Array.from(node.querySelectorAll('button:not(.redaction-cycle)'))].map(
            (element) => getComputedStyle(element).outlineStyle,
          ),
        )
      expect(await outlines()).toEqual(['none', 'none', 'none', 'none'])
      await ui.screenshot('overlay-resizing-no-extra-outline')
      await ui.call('browser_mouse_up')
      await expect
        .poll(async () => Number(await overlay.getAttribute('data-source-end')))
        .toBeGreaterThan(originalEnd)
      expect(await overlay.getAttribute('data-selected')).toBe('false')
      expect(
        await overlay
          .getByRole('button', { name: 'Adjust redaction end' })
          .evaluate((node) => node === document.activeElement),
      ).toBe(false)
      const movedStart = Number(await overlay.getAttribute('data-source-start'))
      const resizedEnd = Number(await overlay.getAttribute('data-source-end'))
      const overlayBox = await overlay.boundingBox()
      if (!overlayBox) throw new Error('OVERLAY_GEOMETRY_MISSING')
      await ui.call('browser_mouse_drag_xy', {
        startX: overlayBox.x + overlayBox.width / 2,
        startY: overlayBox.y + overlayBox.height / 2,
        endX: overlayBox.x + overlayBox.width / 2 + 20,
        endY: overlayBox.y + overlayBox.height / 2,
      })
      await expect
        .poll(async () => Number(await overlay.getAttribute('data-source-start')))
        .toBeGreaterThan(movedStart)
      expect(
        Number(await overlay.getAttribute('data-source-end')) -
          Number(await overlay.getAttribute('data-source-start')),
      ).toBeCloseTo(resizedEnd - movedStart, 6)
      expect(await overlay.getAttribute('data-selected')).toBe('true')
      expect(await outlines()).toEqual(['none', 'none', 'none', 'none'])
      await ui.screenshot('overlay-selected-mask-only')
      const beforeBypass = await overlay.boundingBox()
      const containingClip = overlay.locator('xpath=..')
      const clipBefore = await containingClip.boundingBox()
      if (!beforeBypass || !clipBefore) throw new Error('CLIP_GEOMETRY_MISSING')
      expect(beforeBypass.height).toBeCloseTo(clipBefore.height - 2, 0)
      const rangeBeforeBypass = await overlay.getAttribute('data-source-start')
      await ui.page.keyboard.down('Alt')
      await ui.call('browser_mouse_drag_xy', {
        startX: beforeBypass.x + beforeBypass.width / 2,
        startY: beforeBypass.y + beforeBypass.height / 2,
        endX: beforeBypass.x + beforeBypass.width / 2 + 40,
        endY: beforeBypass.y + beforeBypass.height / 2,
      })
      await ui.page.keyboard.up('Alt')
      await expect
        .poll(async () => (await containingClip.boundingBox())!.x)
        .toBeGreaterThan(clipBefore.x)
      expect(await overlay.getAttribute('data-source-start')).toBe(rangeBeforeBypass)
      await ui.screenshot('overlay-moved-with-clip')
      await ui.call('browser_press_key', { key: 'Control+z' })
      await ui.call('browser_press_key', { key: 'Control+z' })
      await expect
        .poll(async () => Number(await overlay.getAttribute('data-source-start')))
        .toBe(movedStart)
      await ui.call('browser_press_key', { key: 'Control+z' })
      await expect
        .poll(async () => Number(await overlay.getAttribute('data-source-end')))
        .toBe(originalEnd)
      const body = await overlay.locator('button').first().boundingBox()
      if (!body) throw new Error('REDACTION_OVERLAY_MISSING')
      await ui.call('browser_click', { target: '.clip-redaction' })
      await ui.call('browser_press_key', { key: 'Delete' })
      await expect.poll(() => ui.page.locator('.clip-redaction').count()).toBe(0)
      await expect.poll(strike).not.toContain('line-through')
      expect(await ui.page.locator('.waveform-clip').count()).toBe(clipCount)
      await ui.call('browser_press_key', { key: 'Control+z' })
      await expect.poll(strike).toContain('line-through')
      await ui.call('browser_click', {
        target: '.clip-redaction button[aria-label="Adjust redaction end"]',
      })
      await ui.call('browser_press_key', { key: 'ArrowRight' })
      await ui.call('browser_press_key', { key: 'ArrowRight' })
      await expect
        .poll(async () => Number(await overlay.getAttribute('data-source-end')))
        .toBeCloseTo(originalEnd + 0.02, 6)
      await ui.call('browser_press_key', { key: 'Control+s' })
      await expect
        .poll(() => ui.page.locator('.project-save-state').innerText())
        .toBe('All changes saved')
      await ui.restart()
      await open()
      await expect.poll(strike).toContain('line-through')
      expect(
        Number(await ui.page.locator('.clip-redaction').first().getAttribute('data-source-end')),
      ).toBeCloseTo(originalEnd + 0.02, 6)
      await ui.screenshot('transcript-fixture-reopened')
    } finally {
      await ui.close()
    }
  },
)
