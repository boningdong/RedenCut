import { writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { Page } from 'playwright'
import { expect, test } from 'vitest'
import { requireContainerAudio } from '../harness/audio/AudioCapture'
import { McpTestSession } from './support/McpTestSession'

/** Read only the painted canvas: no project, cache or renderer store inspection. */
async function waveformPixels(page: Page) {
  return page
    .locator('.waveform-clip canvas:visible')
    .first()
    .evaluate((canvas: HTMLCanvasElement) => {
      const { width, height } = canvas
      const pixels = canvas.getContext('2d')!.getImageData(0, 0, width, height).data
      let ink = 0
      let extent = 0
      let hash = 2166136261
      for (let index = 3; index < pixels.length; index += 4) {
        const alpha = pixels[index]
        hash = Math.imul(hash ^ alpha, 16777619) >>> 0
        if (alpha > 20) {
          ink++
          const y = Math.floor(index / 4 / width)
          extent = Math.max(extent, Math.abs(y + 0.5 - height / 2))
        }
      }
      return { width, height, ink, extent, hash }
    })
}

test('waveform pixels follow Gain and Normalize while Volume leaves the display unchanged', async () => {
  requireContainerAudio()
  const ui = new McpTestSession()
  const observations: Record<string, Awaited<ReturnType<typeof waveformPixels>>> = {}
  try {
    await ui.start()
    await ui.call('redencut_prepare_dialog', {
      request: {
        purpose: 'import-audio',
        selection: { type: 'file', filename: 'mandarin-short-female.wav' },
      },
    })
    await ui.call('browser_click', { target: 'button:text-is("+ Add Track")' })
    await ui.page.getByRole('button', { name: 'Track 1 gain', exact: true }).waitFor()
    await expect.poll(async () => (await waveformPixels(ui.page)).extent).toBeGreaterThan(8)
    const capture = async (name: string) => {
      observations[name] = await waveformPixels(ui.page)
      await ui.screenshot(name)
      writeFileSync(
        join(ui.directory, 'waveform-pixels.json'),
        JSON.stringify(observations, null, 2),
      )
      return observations[name]
    }
    const setGain = async (text: string) => {
      await ui.call('browser_click', { target: 'button[aria-label="Track 1 gain"]' })
      await ui.call('browser_type', {
        target: 'input[type="number"][aria-label="Track 1 gain"]',
        text,
        submit: true,
      })
      await ui.call('browser_press_key', { key: 'Escape' })
    }
    const toggleNormalize = async () => {
      await ui.call('browser_click', { target: 'button:has-text("Effects")' })
      await ui.call('browser_click', { target: '[role="menuitemcheckbox"]' })
      await ui.call('browser_press_key', { key: 'Escape' })
    }
    const baseline = await capture('waveform-unity')
    // Raster rounding allows one pixel around the initial 85% full-source fit.
    expect(Math.abs(baseline.extent / (baseline.height / 2) - 0.85)).toBeLessThan(
      2 / baseline.height,
    )
    await setGain('-12')
    await expect
      .poll(async () => (await waveformPixels(ui.page)).extent / baseline.extent)
      .toBeLessThan(0.35)
    const attenuated = await capture('waveform-gain-minus12')
    expect(attenuated.extent / baseline.extent).toBeGreaterThan(0.15)
    expect(attenuated.ink).toBeLessThan(baseline.ink * 0.5)

    await ui.call('browser_click', { target: 'button[aria-label="Track 1 volume"]' })
    await ui.call('browser_press_key', { key: 'Home' })
    await ui.call('browser_press_key', { key: 'Escape' })
    expect(
      await ui.page.getByRole('button', { name: 'Track 1 volume', exact: true }).innerText(),
    ).toContain('0%')
    // Let queued UI work settle through an observation before reading the same painted pixels.
    await ui.call('browser_snapshot')
    expect((await capture('waveform-volume-zero')).hash).toBe(attenuated.hash)

    await setGain('0')
    await expect.poll(async () => (await waveformPixels(ui.page)).hash).toBe(baseline.hash)
    await toggleNormalize()
    await expect
      .poll(
        async () => {
          const painted = await waveformPixels(ui.page)
          return painted.ink > 0 && painted.hash !== baseline.hash
        },
        { timeout: 30_000 },
      )
      .toBe(true)
    const normalized = await capture('waveform-normalized')
    expect(normalized.width).toBe(baseline.width)
    expect(normalized.height).toBe(baseline.height)
    expect(await ui.page.getByRole('alert').count()).toBe(0)
    await toggleNormalize()
    await expect
      .poll(async () => (await waveformPixels(ui.page)).hash, { timeout: 30_000 })
      .toBe(baseline.hash)
    await capture('waveform-normalize-disabled')
    await ui.call('redencut_stop', { discardUnsaved: true })
  } catch (error) {
    if (ui.directory) {
      writeFileSync(join(ui.directory, 'e2e-failure.txt'), String(error))
      await ui.screenshot('failure').catch(() => {})
    }
    throw error
  } finally {
    await ui.close()
  }
})
