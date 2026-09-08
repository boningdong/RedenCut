import { writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { expect, test } from 'vitest'
import type { Page } from 'playwright'
import { AudioCapture, requireContainerAudio } from '../harness/audio/AudioCapture'
import { recordedRms } from './audioAnalysis'
import { McpTestSession } from './support/McpTestSession'

const filename = 'mandarin-short-female.wav'

// Read-only UI observations: displayed time, painted waveforms and ruler-relative geometry.
async function visibleTime(page: Page): Promise<number> {
  const text = await page
    .getByTitle('Skip to start', { exact: true })
    .locator('..')
    .locator('span')
    .first()
    .innerText()
  const [minutes, seconds] = text.split(':').map(Number)
  if (!Number.isFinite(minutes + seconds)) throw new Error(`VISIBLE_TIME_UNREADABLE: ${text}`)
  return minutes * 60 + seconds
}

async function drawnWaveforms(page: Page, count: number): Promise<void> {
  await expect
    .poll(
      async () => {
        const canvases = page.locator('canvas:visible')
        if ((await canvases.count()) !== count) return false
        for (const canvas of await canvases.all()) {
          // Pixels of the displayed waveform, not readiness flags or source metadata.
          const ink = await canvas.evaluate((element: HTMLCanvasElement) => {
            const pixels = element
              .getContext('2d')!
              .getImageData(0, 0, element.width, element.height).data
            let painted = 0
            for (let y = 0; y < element.height; y++) {
              if (Math.abs(y - element.height / 2) < 3) continue
              for (let x = 0; x < element.width; x++)
                if (pixels[(y * element.width + x) * 4 + 3] > 0) painted++
            }
            return painted
          })
          if (ink < 100) return false
        }
        return true
      },
      { timeout: 30_000, interval: 200 },
    )
    .toBe(true)
}

async function ruler(page: Page) {
  const timeline = page.locator('#waveform-timeline')
  const box = await timeline.boundingBox()
  const zero = await timeline.getByText('0s', { exact: true }).boundingBox()
  const one = await timeline.getByText('1s', { exact: true }).boundingBox()
  if (!box || !zero || !one) throw new Error('VISIBLE_RULER_UNAVAILABLE')
  return { x: box.x, y: box.y + box.height / 2, pixelsPerSecond: one.x - zero.x }
}

async function layout(page: Page) {
  const scale = await ruler(page)
  const clips = []
  for (const canvas of await page.locator('canvas:visible').all()) {
    const box = await canvas.locator('..').boundingBox()
    if (!box) throw new Error('VISIBLE_CLIP_MISSING')
    clips.push({
      start: (box.x - scale.x) / scale.pixelsPerSecond,
      duration: box.width / scale.pixelsPerSecond,
      box,
    })
  }
  return clips.sort((a, b) => a.start - b.start)
}

test('split and drag survive save and reopen as visible clips with audible playback', async () => {
  // Reject unsupported environments before creating an app session or recording.
  requireContainerAudio()
  const ui = new McpTestSession()
  let capture: AudioCapture | undefined
  try {
    // Import real audio through MCP and wait for visible waveform pixels.
    await ui.start()
    await ui.call('podcut_prepare_dialog', {
      request: { purpose: 'import-audio', selection: { type: 'file', filename } },
    })
    await ui.call('browser_click', { target: 'button:text-is("Import Audio")' })
    await drawnWaveforms(ui.page, 1)

    // Select the clip, position the playhead near 5 seconds and split with the real shortcut.
    const scale = await ruler(ui.page)
    await ui.call('browser_click', { target: 'canvas' })

    // Aim one pixel past the tick: displayed seconds are floored, and mouse coordinates round.
    await ui.call('browser_mouse_click_xy', {
      x: scale.x + 5 * scale.pixelsPerSecond + 1,
      y: scale.y,
    })
    expect(await visibleTime(ui.page)).toBe(5)
    await ui.call('browser_press_key', { key: 's' })
    await drawnWaveforms(ui.page, 2)
    const split = await layout(ui.page)
    expect(split[0].start).toBeCloseTo(0, 1)
    expect(Math.abs(split[0].duration - 5)).toBeLessThan(0.1)
    expect(Math.abs(split[1].start - 5)).toBeLessThan(0.1)
    await ui.screenshot('split')

    // Drag the second clip about 2 seconds later; verify the gap and unchanged clip lengths.
    const second = split[1].box
    await ui.call('browser_mouse_drag_xy', {
      startX: second.x + 30,
      startY: second.y + second.height / 2,
      endX: second.x + 30 + 2 * scale.pixelsPerSecond,
      endY: second.y + second.height / 2,
    })
    await drawnWaveforms(ui.page, 2)
    const moved = await layout(ui.page)
    expect(Math.abs(moved[0].start)).toBeLessThan(0.1)
    expect(Math.abs(moved[0].duration - split[0].duration)).toBeLessThan(0.1)
    expect(Math.abs(moved[1].start - 7)).toBeLessThan(0.15)
    expect(Math.abs(moved[1].duration - split[1].duration)).toBeLessThan(0.15)
    await ui.screenshot('moved')

    // Save and fully restart; compare the reopened visible layout with the edited layout.
    const selection = { type: 'project', name: 'edited-audio.podcut' }
    await ui.call('podcut_prepare_dialog', { request: { purpose: 'save-project', selection } })
    await ui.call('browser_click', { target: 'button:text-is("Save")' })
    await expect.poll(() => ui.page.locator('header strong').innerText()).toContain('edited-audio')
    await ui.restart()
    await ui.call('podcut_prepare_dialog', { request: { purpose: 'open-project', selection } })
    await ui.call('browser_click', { target: 'button:text-is("Open Project")' })
    await drawnWaveforms(ui.page, 2)
    const reopened = await layout(ui.page)
    for (let i = 0; i < 2; i++) {
      expect(Math.abs(reopened[i].start - moved[i].start)).toBeLessThan(0.1)
      expect(Math.abs(reopened[i].duration - moved[i].duration)).toBeLessThan(0.1)
    }
    await ui.screenshot('edited-reopened')

    // Play the beginning after reopening and verify actual audible output, not just a moving clock.
    capture = await AudioCapture.start(ui.directory, 'edited-reopened-playback')
    await ui.call('browser_click', { target: 'button[title="Skip to start"]' })
    await ui.call('browser_click', { target: 'button[title="Play (Space)"]' })
    await expect.poll(() => visibleTime(ui.page), { timeout: 8000 }).toBeGreaterThanOrEqual(3)
    await ui.call('browser_click', { target: 'button[title="Pause (Space)"]' })
    const levels = recordedRms(await capture.stop())
    expect(levels.filter((value) => value > 0.002).length).toBeGreaterThanOrEqual(5)
    writeFileSync(
      join(ui.directory, 'editing-observations.json'),
      JSON.stringify({ split, moved, reopened, levels }, null, 2),
    )
    await ui.call('podcut_stop')
  } catch (error) {
    // Preserve failure screenshots; always finalize recording before releasing the app session.
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
})

test('play pause seek and resume control visible time and real container audio', async () => {
  // This scenario requires the private container audio device, never host speakers.
  requireContainerAudio()
  const ui = new McpTestSession()
  let capture: AudioCapture | undefined
  try {
    // Import through the UI and wait for the rendered waveform.
    await ui.start()
    await ui.call('podcut_prepare_dialog', {
      request: { purpose: 'import-audio', selection: { type: 'file', filename } },
    })
    await ui.call('browser_click', { target: 'button:text-is("Import Audio")' })
    await drawnWaveforms(ui.page, 1)

    // Start recording before Play; verify the button, advancing time and sustained audio.
    capture = await AudioCapture.start(ui.directory, 'playing')
    await ui.call('browser_click', { target: 'button[title="Play (Space)"]' })
    await expect
      .poll(() => ui.page.getByTitle('Pause (Space)', { exact: true }).isVisible())
      .toBe(true)
    await expect.poll(() => visibleTime(ui.page), { timeout: 8000 }).toBeGreaterThanOrEqual(3)
    const playing = recordedRms(await capture.stop())
    expect(playing.filter((rms) => rms > 0.002).length).toBeGreaterThanOrEqual(5)

    // Pause and observe the clock over time while recording the device's quiet output.
    await ui.call('browser_click', { target: 'button[title="Pause (Space)"]' })
    const pausedAt = await visibleTime(ui.page)
    await ui.screenshot('paused')
    capture = await AudioCapture.start(ui.directory, 'paused-and-seeked')

    // Sample over real elapsed time to prove stability, not just one unchanged read.
    for (let i = 0; i < 6; i++) {
      await new Promise((resolve) => setTimeout(resolve, 200))
      expect(await visibleTime(ui.page)).toBe(pausedAt)
    }

    // Seek near 8 seconds while paused; verify it neither advances nor resumes sound.
    const scale = await ruler(ui.page)
    await ui.call('browser_mouse_click_xy', {
      x: scale.x + 8 * scale.pixelsPerSecond + 1,
      y: scale.y,
    })
    expect(await visibleTime(ui.page)).toBe(8)
    expect(await ui.page.getByTitle('Play (Space)', { exact: true }).isVisible()).toBe(true)
    for (let i = 0; i < 6; i++) {
      await new Promise((resolve) => setTimeout(resolve, 200))
      expect(await visibleTime(ui.page)).toBe(8)
    }
    const quiet = recordedRms(await capture.stop())

    // Allow up to one second of buffered output, then require sustained silence.
    expect(quiet.slice(10).length).toBeGreaterThanOrEqual(10)
    expect(Math.max(...quiet.slice(10))).toBeLessThan(0.0001)
    await ui.screenshot('seeked-while-paused')

    // Resume from the visible seek position and verify audio returns; retain the evidence.
    capture = await AudioCapture.start(ui.directory, 'resumed')
    await ui.call('browser_click', { target: 'button[title="Play (Space)"]' })
    await expect.poll(() => visibleTime(ui.page), { timeout: 6000 }).toBeGreaterThanOrEqual(10)
    expect(await ui.page.getByTitle('Pause (Space)', { exact: true }).isVisible()).toBe(true)
    await ui.call('browser_click', { target: 'button[title="Pause (Space)"]' })
    const resumed = recordedRms(await capture.stop())
    expect(resumed.filter((rms) => rms > 0.002).length).toBeGreaterThanOrEqual(5)
    writeFileSync(
      join(ui.directory, 'playback-observations.json'),
      JSON.stringify({ pausedAt, playing, quiet, resumed }, null, 2),
    )
    await ui.screenshot('resumed-then-paused')
    await ui.call('podcut_stop', { discardUnsaved: true })
  } catch (error) {
    // Preserve failure screenshots; always finalize recording before releasing the app session.
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
})
