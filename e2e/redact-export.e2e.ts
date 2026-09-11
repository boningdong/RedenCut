import { execFileSync } from 'node:child_process'
import { writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { expect, test } from 'vitest'
import { requireContainerAudio } from '../harness/audio/AudioCapture'
import { McpTestSession } from './support/McpTestSession'

// Inspect produced media, not renderer state or a manufactured project.
function decode(path: string) {
  const duration = Number(
    execFileSync(
      'ffprobe',
      ['-v', 'error', '-show_entries', 'format=duration', '-of', 'default=nw=1:nk=1', path],
      { encoding: 'utf8' },
    ).trim(),
  )
  const bytes = execFileSync(
    'ffmpeg',
    ['-v', 'error', '-i', path, '-ac', '1', '-ar', '48000', '-f', 'f32le', '-'],
    { maxBuffer: 16 * 1024 * 1024 },
  )
  const pcm = Float32Array.from({ length: bytes.length / 4 }, (_, i) => bytes.readFloatLE(i * 4))
  return { duration, pcm }
}
function correlation(a: Float32Array, b: Float32Array, aSeconds: number, bSeconds: number) {
  // Visible geometry rounds at a pixel; find sample alignment within 50 ms.
  let best = -1
  for (let lag = -2400; lag <= 2400; lag++) {
    let dot = 0,
      aa = 0,
      bb = 0
    for (let j = 0; j < 24000; j += 8) {
      const x = a[Math.round(aSeconds * 48000) + j]
      const y = b[Math.round(bSeconds * 48000) + j + lag]
      dot += x * y
      aa += x * x
      bb += y * y
    }
    best = Math.max(best, dot / Math.sqrt(aa * bb))
  }
  return best
}

test('UI export removes redactions with Preview off, while preserving mute, gaps and retained overlap', async () => {
  requireContainerAudio()
  const ui = new McpTestSession()
  const evidence: Record<string, unknown> = {}
  try {
    await ui.start()
    await ui.call('browser_resize', { width: 1440, height: 1000 })
    const importTrack = async () => {
      await ui.call('podcut_prepare_dialog', {
        request: {
          purpose: 'import-audio',
          selection: { type: 'file', filename: 'mandarin-short-female.wav' },
        },
      })
      await ui.call('browser_click', { target: 'button:text-is("+ Add Track")' })
    }
    await importTrack()
    await expect.poll(() => ui.page.locator('canvas:visible').count()).toBe(1)
    const ruler = async () => {
      const timeline = await ui.page.locator('#waveform-timeline').boundingBox()
      const zero = await ui.page
        .locator('#waveform-timeline')
        .getByText('0s', { exact: true })
        .boundingBox()
      const one = await ui.page
        .locator('#waveform-timeline')
        .getByText('1s', { exact: true })
        .boundingBox()
      if (!timeline || !zero || !one) throw new Error('RULER_NOT_VISIBLE')
      return { x: timeline.x, y: timeline.y + timeline.height / 2, pps: one.x - zero.x }
    }
    const select = async (index: number) => {
      const box = await ui.page.locator('canvas:visible').nth(index).boundingBox()
      if (!box) throw new Error('CLIP_NOT_VISIBLE')
      await ui.call('browser_mouse_click_xy', {
        x: box.x + box.width / 2,
        y: box.y + box.height / 2,
      })
    }
    const exportWav = async (name: string) => {
      await ui.call('browser_click', { target: 'header button:text-is("Export")' })
      await expect
        .poll(() => ui.page.getByText('Export Audio', { exact: true }).isVisible())
        .toBe(true)
      await ui.call('browser_select_option', { target: 'select', values: ['wav'] })
      await ui.call('podcut_prepare_dialog', {
        request: {
          purpose: 'export-audio',
          selection: { type: 'export', filename: `${name}.wav`, format: 'wav' },
        },
      })
      await ui.call('browser_click', { target: 'button:text-is("Export"):not(header button)' })
      await expect
        .poll(() => ui.page.getByText('Done!', { exact: true }).isVisible(), { timeout: 30000 })
        .toBe(true)
      await ui.screenshot(`export-${name}`)
      await ui.call('browser_click', { target: 'button:text-is("Close")' })
      const result = decode(join(ui.directory, 'exports', `${name}.wav`))
      evidence[name] = { duration: result.duration }
      return result
    }
    const original = await exportWav('original')
    expect(original.duration).toBeCloseTo(13.5, 1)
    for (const [index, seconds] of [
      [0, 3],
      [1, 8],
    ]) {
      await select(index)
      const scale = await ruler()
      await ui.call('browser_mouse_click_xy', { x: scale.x + seconds * scale.pps, y: scale.y })
      await ui.call('browser_press_key', { key: 's' })
    }
    await expect.poll(() => ui.page.locator('canvas:visible').count()).toBe(3)
    await select(1)
    await ui.call('browser_press_key', { key: 'm' })
    expect(
      await ui.page
        .getByRole('button', { name: 'Preview', exact: true })
        .getAttribute('aria-pressed'),
    ).not.toBe('true')
    const redacted = await exportWav('redacted-preview-off')
    expect(redacted.duration).toBeCloseTo(8.5, 1)
    const prefix = correlation(redacted.pcm, original.pcm, 1, 1)
    const retainedTail = correlation(redacted.pcm, original.pcm, 4, 9)
    evidence.content = { prefix, retainedTail }
    expect(prefix).toBeGreaterThan(0.98)
    expect(retainedTail).toBeGreaterThan(0.98)
    await ui.call('browser_click', { target: 'button[aria-label="Preview"]' })
    const redactedOn = await exportWav('redacted-preview-on')
    expect(redactedOn.duration).toBe(redacted.duration)
    expect(correlation(redactedOn.pcm, redacted.pcm, 4, 4)).toBeGreaterThan(0.999)
    await ui.call('browser_click', { target: 'button[aria-label="Preview"]' })

    // Undo clip redaction, then verify track-level mute keeps the timeline duration.
    await ui.call('browser_press_key', { key: 'Control+z' })
    await ui.call('browser_click', { target: 'button[aria-label="Mute Track 1"]' })
    const muted = await exportWav('track-muted')
    expect(muted.duration).toBeCloseTo(original.duration, 1)
    expect(muted.pcm.every((sample) => Math.abs(sample) < 0.00001)).toBe(true)
    await ui.call('browser_click', { target: 'button[aria-label="Mute Track 1"]' })

    const box = await ui.page.locator('canvas:visible').nth(2).boundingBox()
    if (!box) throw new Error('LAST_CLIP_NOT_VISIBLE')
    const scale = await ruler()
    await ui.call('browser_mouse_drag_xy', {
      startX: box.x + 25,
      startY: box.y + box.height / 2,
      endX: box.x + 25 + scale.pps * 2,
      endY: box.y + box.height / 2,
    })
    const gap = await exportWav('natural-gap')
    expect(gap.duration).toBeCloseTo(15.5, 1)
    const gapPcm = gap.pcm.slice(8.2 * 48000, 9.8 * 48000)
    expect(gapPcm.every((sample) => Math.abs(sample) < 0.00001)).toBe(true)
    expect(correlation(gap.pcm, original.pcm, 11, 9)).toBeGreaterThan(0.98)
    await ui.call('browser_press_key', { key: 'Control+z' })
    await select(1)
    await ui.call('browser_press_key', { key: 'm' })
    await importTrack()
    await expect.poll(() => ui.page.locator('canvas:visible').count()).toBe(4)
    const overlap = await exportWav('retained-overlap')
    expect(overlap.duration).toBeCloseTo(13.5, 1)
    expect(correlation(overlap.pcm, original.pcm, 5, 5)).toBeGreaterThan(0.98)
    await ui.call('browser_click', { target: 'button[aria-label="Preview"]' })
    const previewOn = await exportWav('retained-overlap-preview-on')
    expect(previewOn.duration).toBe(overlap.duration)
    expect(correlation(previewOn.pcm, overlap.pcm, 5, 5)).toBeGreaterThan(0.999)
  } finally {
    if (ui.directory)
      writeFileSync(
        join(ui.directory, 'export-verification.json'),
        JSON.stringify(evidence, null, 2),
      )
    await ui.close()
  }
})
