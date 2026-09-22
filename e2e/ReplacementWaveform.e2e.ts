import { writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { expect, test } from 'vitest'
import { McpTestSession } from './support/McpTestSession'

test.each([3, 4, 6])(
  'replacement with %i sources survives processing, Normalize and reopen',
  async (sourceCount) => {
    const ui = new McpTestSession()
    try {
      await ui.start()
      for (let i = 0; i < sourceCount + 1; i++) {
        await ui.call('redencut_prepare_dialog', {
          request: {
            purpose: 'import-audio',
            selection: { type: 'file', filename: 'mandarin-short-female.wav' },
          },
        })
        await ui.call('browser_click', { target: 'button:text-is("+ Add Track")' })
      }
      await ui.call('browser_click', {
        target: '[aria-label="Track 1 track actions"] button[aria-label="Linked recordings"]',
      })
      for (const name of Array.from({ length: sourceCount }, (_, i) => `Track ${i + 2}`))
        await ui.call('browser_click', { target: `input[aria-label="${name}"]` })
      await ui.call('browser_click', {
        target: 'label:has-text("These recordings are already aligned") input',
      })
      await ui.call('browser_click', { target: 'button:text-is("Link to Mix")' })
      await ui.call('browser_click', { target: 'button:text-is("Track 1")' })
      const ruler = ui.page.locator('#waveform-timeline')
      const zero = await ruler.getByText('0s', { exact: true }).boundingBox()
      const one = await ruler.getByText('1s', { exact: true }).boundingBox()
      if (!zero || !one) throw new Error('RULER_MISSING')
      const scale = one.x - zero.x
      await ui.call('browser_mouse_drag_xy', {
        startX: zero.x + 2 * scale,
        startY: zero.y + 12,
        endX: zero.x + 6 * scale,
        endY: zero.y + 12,
      })
      await ui.call('browser_click', { target: '.mix-range-toolbar button' })
      for (const name of Array.from({ length: sourceCount }, (_, i) => `Track ${i + 2}`))
        await ui.call('browser_click', { target: `input[aria-label="${name}"]` })
      await ui.call('browser_click', { target: 'button:text-is("Apply replacement")' })
      await ui.call('browser_press_key', { key: 'Escape' })

      const observe = async (name: string) => {
        // Await the *completed* master processing branch, not the transient raw fallback.
        await expect
          .poll(
            () =>
              ui.page
                .locator('[data-processed-waveform] canvas[data-waveform-ready="true"]')
                .count(),
            { timeout: 30000 },
          )
          .toBe(2)
        await expect.poll(() => ui.page.locator('.waveform-update-status').count()).toBe(0)
        const rows = ui.page.locator('[data-source-override]')
        expect(await rows.count()).toBe(sourceCount <= 3 ? sourceCount : 0)
        const evidence = []
        for (const row of await rows.all()) {
          const canvas = row.locator('canvas')
          await expect.poll(() => canvas.getAttribute('data-waveform-ready')).toBe('true')
          const painted = await canvas.evaluate((element: HTMLCanvasElement) => {
            const data = element
              .getContext('2d')!
              .getImageData(0, 0, element.width, element.height).data
            let ink = 0,
              r = 0,
              g = 0,
              b = 0
            for (let i = 0; i < data.length; i += 4)
              if (data[i + 3] > 200) {
                ink++
                r += data[i]
                g += data[i + 1]
                b += data[i + 2]
              }
            return {
              ink,
              color: [r / ink, g / ink, b / ink],
              width: element.width,
              height: element.height,
            }
          })
          expect(painted.ink).toBeGreaterThan(50)
          evidence.push({ ...painted, box: await canvas.boundingBox() })
        }
        const caption = await ui.page.locator('.mix-replacement-caption').boundingBox()
        const range = await ui.page.locator('.mix-replacement-range').boundingBox()
        expect(caption!.y).toBeCloseTo(range!.y, 0)
        if (sourceCount <= 3) {
          expect(evidence[0].box!.y).toBeGreaterThanOrEqual(caption!.y + caption!.height)
          for (let i = 1; i < evidence.length; i++) {
            expect(evidence[i - 1].box!.y + evidence[i - 1].box!.height).toBeLessThanOrEqual(
              evidence[i].box!.y + 1,
            )
          }
          const last = evidence.at(-1)!.box!
          expect(last.y + last.height).toBeCloseTo(range!.y + range!.height, 0)
          expect(evidence[0].color).not.toEqual(evidence[1].color)
        } else {
          expect(await ui.page.locator('[data-mix-presentation="combined"]').count()).toBe(1)
          const combined = ui.page.locator('.mix-combined-wave canvas')
          await expect.poll(() => combined.getAttribute('data-waveform-ready')).toBe('true')
          const painted = await combined.evaluate((canvas: HTMLCanvasElement) => {
            const { data } = canvas
              .getContext('2d')!
              .getImageData(0, 0, canvas.width, canvas.height)
            const y = Math.floor(canvas.height / 2)
            let longest = 0,
              run = 0,
              ink = 0
            for (let x = 0; x < canvas.width; x++) {
              // Ignore faint antialiasing fringes between adjacent 1.5 px bars.
              if (data[(y * canvas.width + x) * 4 + 3] > 128) {
                run++
                ink++
              } else run = 0
              longest = Math.max(longest, run)
            }
            return { longest: longest / devicePixelRatio, ink }
          })
          expect(painted.ink).toBeGreaterThan(10)
          expect(painted.longest).toBeLessThanOrEqual(3)
          const wave = await ui.page.locator('.mix-combined-wave').boundingBox()
          expect(wave!.y).toBeGreaterThanOrEqual(caption!.y + caption!.height)
          expect(wave!.y + wave!.height).toBeCloseTo(range!.y + range!.height, 0)
          expect(await ui.page.locator('.mix-participant-count').innerText()).toBe(
            `${sourceCount} sources`,
          )
        }
        expect(await ui.page.locator('.mix-participant').count()).toBe(sourceCount)
        await ui.screenshot(name)
        writeFileSync(join(ui.directory, name + '.json'), JSON.stringify(evidence, null, 2))
      }
      await observe('processed-source-layers')
      await ui.call('browser_click', {
        target: '[aria-label="Track 1 track actions"] button:has-text("Effects")',
      })
      await ui.call('browser_click', { target: '[role="menuitemcheckbox"]' })
      await ui.call('browser_press_key', { key: 'Escape' })
      await observe('normalized-source-layers')
      await ui.call('browser_resize', { width: 900, height: 650 })
      await observe('narrow-source-layers')
      const selection = { type: 'project', name: 'source-layers.redencut' }
      await ui.call('redencut_prepare_dialog', { request: { purpose: 'save-project', selection } })
      await ui.call('browser_click', { target: 'button:text-is("Save")' })
      await ui.restart()
      await ui.call('redencut_prepare_dialog', { request: { purpose: 'open-project', selection } })
      await ui.call('browser_click', { target: '.project-name' })
      await ui.call('browser_click', { target: 'button:text-is("Open Project")' })
      await observe('reopened-source-layers')
      await ui.call('redencut_stop', { discardUnsaved: true })
    } finally {
      await ui.close()
    }
  },
  120000,
)
