import { execFileSync } from 'node:child_process'
import { rmSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { expect, test } from 'vitest'
import { requireContainerAudio } from '../harness/audio/AudioCapture'
import { McpTestSession } from './support/McpTestSession'

// Read painted pixels and visible status only; MCP owns every application action.
async function observation(ui: McpTestSession) {
  return ui.page.locator('body').evaluate((body) => {
    const canvas = Array.from(
      body.querySelectorAll<HTMLCanvasElement>('.waveform-clip canvas'),
    ).find((element) => element.getBoundingClientRect().width > 0)
    let ink = 0
    let hash = 2166136261
    if (canvas) {
      const pixels = canvas.getContext('2d')!.getImageData(0, 0, canvas.width, canvas.height).data
      for (let index = 3; index < pixels.length; index += 4) {
        const alpha = pixels[index]
        hash = Math.imul(hash ^ alpha, 16777619) >>> 0
        if (alpha > 20) ink++
      }
    }
    const status = body.querySelector('.waveform-update-status')
    return {
      text: status?.textContent ?? '',
      phase: status?.getAttribute('data-preparation-phase') ?? null,
      ink,
      hash,
    }
  })
}

test('long Auto Level preparation reports real stages while retaining the existing waveform', async () => {
  requireContainerAudio()
  const filename = `auto-level-preparation-${process.pid}.wav`
  const fixture = resolve('e2e/fixtures/audio', filename)
  const ui = new McpTestSession()
  const observations: Record<
    string,
    { elapsedMs: number; samples: Awaited<ReturnType<typeof observation>>[] }
  > = {}
  try {
    // Created only in the disposable container snapshot and removed in finally.
    execFileSync('ffmpeg', [
      '-v',
      'error',
      '-f',
      'lavfi',
      '-i',
      "aevalsrc='if(lt(mod(t,12),6),0.018,0.18)*sin(2*PI*230*t)':s=48000:d=1200",
      '-c:a',
      'pcm_s16le',
      fixture,
    ])
    await ui.start()
    await ui.call('redencut_prepare_dialog', {
      request: { purpose: 'import-audio', selection: { type: 'file', filename } },
    })
    await ui.call('browser_click', { target: 'button:text-is("+ Add Track")' })
    await ui.page
      .getByRole('button', { name: 'Track 1 gain', exact: true })
      .waitFor({ timeout: 60_000 })
    await expect
      .poll(async () => (await observation(ui)).ink, { timeout: 60_000 })
      .toBeGreaterThan(0)
    const baseline = await observation(ui)
    await ui.screenshot('long-audio-before')

    const observeAction = async (
      name: string,
      action: () => Promise<void>,
      done: (value: Awaited<ReturnType<typeof observation>>) => boolean,
    ) => {
      let stopped = false
      const samples: Awaited<ReturnType<typeof observation>>[] = []
      const started = performance.now()
      const observer = (async () => {
        while (!stopped) {
          samples.push(await observation(ui))
          await new Promise((resolve) => setTimeout(resolve, 20))
        }
      })()
      try {
        await action()
        await expect.poll(async () => done(await observation(ui)), { timeout: 90_000 }).toBe(true)
      } finally {
        stopped = true
        await observer
        observations[name] = { elapsedMs: performance.now() - started, samples }
        writeFileSync(
          join(ui.directory, 'auto-level-progress.json'),
          JSON.stringify(observations, null, 2),
        )
      }
      return samples
    }
    const toggle = async () => {
      await ui.call('browser_click', { target: 'button:has-text("Effects")' })
      await ui.call('browser_click', { target: '[role="menuitemcheckbox"]' })
      await ui.call('browser_press_key', { key: 'Escape' })
    }
    const cold = await observeAction(
      'cold-prepare',
      toggle,
      (value) => !value.phase && value.ink > 0 && value.hash !== baseline.hash,
    )
    for (const phase of ['processing', 'waveform']) {
      const matching = cold.filter((sample) => sample.phase === phase && /\d+%/.test(sample.text))
      expect(matching.length, `${phase} percentages must be visible`).toBeGreaterThan(0)
      expect(
        matching.some((sample) => sample.ink > 0 && sample.hash === baseline.hash),
        `${phase} keeps the existing waveform`,
      ).toBe(true)
      const percentages = matching.map((sample) => Number(sample.text.match(/(\d+)%/)![1]))
      expect(
        percentages.some((value) => value < 100),
        `${phase} includes incomplete real work`,
      ).toBe(true)
      expect(percentages).toEqual([...percentages].sort((a, b) => a - b))
    }
    const prepared = await observation(ui)
    await ui.screenshot('long-audio-prepared')
    await toggle()
    await expect.poll(async () => (await observation(ui)).hash).toBe(baseline.hash)
    const warm = await observeAction(
      'warm-reenable',
      toggle,
      (value) => !value.phase && value.hash === prepared.hash,
    )
    expect(warm.some((sample) => /\d+%/.test(sample.text) && !sample.text.includes('100%'))).toBe(
      false,
    )
    await ui.screenshot('long-audio-reenabled')
    const gain = await observeAction(
      'gain-only',
      async () => {
        await ui.call('browser_click', { target: 'button[aria-label="Track 1 gain"]' })
        await ui.call('browser_type', {
          target: 'input[type="number"][aria-label="Track 1 gain"]',
          text: '-6',
          submit: true,
        })
        await ui.call('browser_press_key', { key: 'Escape' })
      },
      (value) => !value.phase && value.ink > 0 && value.hash !== prepared.hash,
    )
    expect(gain.every((sample) => !sample.phase)).toBe(true)
    expect(await ui.page.getByRole('alert').count()).toBe(0)
    await ui.screenshot('long-audio-gain-only')
    await ui.call('redencut_stop', { discardUnsaved: true })
  } catch (error) {
    if (ui.directory) {
      writeFileSync(join(ui.directory, 'e2e-failure.txt'), String(error))
      await ui.screenshot('failure').catch(() => {})
    }
    throw error
  } finally {
    try {
      await ui.close()
    } finally {
      rmSync(fixture, { force: true })
    }
  }
}, 240_000)
