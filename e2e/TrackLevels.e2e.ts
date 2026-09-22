import { writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { expect, test } from 'vitest'
import { AudioCapture, requireContainerAudio } from '../harness/audio/AudioCapture'
import { recordedRms } from './audioAnalysis'
import { McpTestSession } from './support/McpTestSession'

// These assertions observe device recordings and visible controls, never application stores.
test('track volume and gain change real preview output and Normalize remains playable', async () => {
  requireContainerAudio()
  const ui = new McpTestSession()
  let capture: AudioCapture | undefined
  const observations: Record<string, number[]> = {}
  try {
    await ui.start()
    await ui.call('redencut_prepare_dialog', {
      request: {
        purpose: 'import-audio',
        selection: { type: 'file', filename: 'mandarin-short-female.wav' },
      },
    })
    await ui.call('browser_click', { target: 'button:text-is("+ Add Track")' })
    await ui.page.getByRole('button', { name: 'Track 1 volume', exact: true }).waitFor()
    const record = async (name: string) => {
      await ui.call('browser_click', { target: '[aria-label="Skip to start"]' })
      capture = await AudioCapture.start(ui.directory, name)
      await ui.call('browser_click', { target: '[aria-label="Play"]' })
      await expect
        .poll(
          async () => {
            const time = await ui.page.locator('.transport-time > span').innerText()
            return Number(time.split(':')[1])
          },
          { timeout: 20_000 },
        )
        .toBeGreaterThanOrEqual(4)
      await ui.call('browser_click', { target: '[aria-label="Pause"]' })
      observations[name] = recordedRms(await capture.stop())
      capture = undefined
      await ui.screenshot(name)
      writeFileSync(
        join(ui.directory, 'track-level-recordings.json'),
        JSON.stringify(observations, null, 2),
      )
      // Average the loudest five100ms windows so capture startup latency cannot bias comparison.
      return (
        [...observations[name]]
          .sort((a, b) => b - a)
          .slice(0, 5)
          .reduce((a, b) => a + b, 0) / 5
      )
    }
    const volume = async (key: string) => {
      await ui.call('browser_click', { target: '[aria-label="Track 1 volume"]' })
      await ui.call('browser_press_key', { key })
      await ui.call('browser_press_key', { key: 'Escape' })
    }
    const gain = async (value: string) => {
      await ui.call('browser_click', { target: 'button[aria-label="Track 1 gain"]' })
      await ui.call('browser_type', {
        target: 'input[type="number"][aria-label="Track 1 gain"]',
        text: value,
        submit: true,
      })
      await ui.call('browser_press_key', { key: 'Escape' })
    }
    const baseline = await record('unity')
    expect(baseline).toBeGreaterThan(0.002)
    // Hold the pointer down: audition must change before the undoable gesture commits.
    await ui.call('browser_click', { target: '[aria-label="Play"]' })
    await ui.call('browser_click', { target: 'button[aria-label="Track 1 volume"]' })
    const slider = await ui.page.getByRole('slider', { name: 'Track 1 volume' }).boundingBox()
    if (!slider) throw new Error('VOLUME_SLIDER_MISSING')
    await ui.call('browser_mouse_move_xy', {
      x: slider.x + slider.width - 6,
      y: slider.y + slider.height / 2,
    })
    await ui.call('browser_mouse_down')
    await ui.call('browser_mouse_move_xy', { x: slider.x, y: slider.y + slider.height / 2 })
    capture = await AudioCapture.start(ui.directory, 'volume-held-zero')
    await new Promise((resolve) => setTimeout(resolve, 1200))
    observations['volume-held-zero'] = recordedRms(await capture.stop())
    capture = undefined
    await ui.call('browser_mouse_up')
    await ui.call('browser_press_key', { key: 'Escape' })
    await ui.call('browser_click', { target: '[aria-label="Pause"]' })
    writeFileSync(
      join(ui.directory, 'track-level-recordings.json'),
      JSON.stringify(observations, null, 2),
    )
    expect(Math.max(...observations['volume-held-zero'].slice(5))).toBeLessThan(0.0001)
    await volume('Home')
    const silent = await record('volume-zero')
    expect(silent).toBeLessThan(0.0001)
    await volume('End')
    await gain('-12')
    const attenuated = await record('gain-minus12')
    expect(20 * Math.log10(attenuated / baseline)).toBeCloseTo(-12, 0)
    await gain('0')
    await ui.call('browser_click', { target: 'button:has-text("Effects")' })
    await ui.call('browser_click', { target: '[role="menuitemcheckbox"]' })
    await ui.call('browser_press_key', { key: 'Escape' })
    expect(await record('normalized')).toBeGreaterThan(0.002)
    expect(await ui.page.getByRole('alert').count()).toBe(0)
    await gain('-12')
    const normalizedLow = await record('normalized-minus12')
    const normalized =
      [...observations.normalized]
        .sort((a, b) => b - a)
        .slice(0, 5)
        .reduce((a, b) => a + b, 0) / 5
    expect(20 * Math.log10(normalizedLow / normalized)).toBeCloseTo(-12, 0)
    // Exercise concurrent normalization on four visible tracks, matching the reported layout.
    for (let index = 2; index <= 4; index++) {
      await ui.call('redencut_prepare_dialog', {
        request: {
          purpose: 'import-audio',
          selection: { type: 'file', filename: 'mandarin-short-female.wav' },
        },
      })
      await ui.call('browser_click', { target: 'button:text-is("+ Add Track")' })
      await ui.page.getByRole('button', { name: `Track ${index} volume`, exact: true }).waitFor()
      await ui.call('browser_click', {
        target: `[aria-label="Track ${index} track actions"] button:has-text("Effects")`,
      })
      await ui.call('browser_click', { target: '[role="menuitemcheckbox"]' })
      await ui.call('browser_press_key', { key: 'Escape' })
    }
    expect(await record('four-normalized-tracks')).toBeGreaterThan(0.002)
    await ui.call('redencut_stop', { discardUnsaved: true })
  } catch (error) {
    if (ui.directory) {
      writeFileSync(join(ui.directory, 'e2e-failure.txt'), String(error))
      await ui.screenshot('failure').catch(() => {})
    }
    throw error
  } finally {
    try {
      await capture?.stop()
    } finally {
      await ui.close()
    }
  }
}, 180_000)
