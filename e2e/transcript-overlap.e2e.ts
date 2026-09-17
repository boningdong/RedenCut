import { expect, test } from 'vitest'
import { McpTestSession } from './support/McpTestSession'

test('real track occurrences align locally and follow clip movement and undo', async () => {
  const ui = new McpTestSession()
  try {
    await ui.start()
    const importAudio = async (expectedTracks: number, filename = 'mandarin-short-female.wav') => {
      await ui.call('redencut_prepare_dialog', {
        request: {
          purpose: 'import-audio',
          selection: { type: 'file', filename },
        },
      })
      await ui.call('browser_click', { target: 'button:text-is("+ Add Track")' })
      await expect
        .poll(() => ui.page.locator('.waveform-clip canvas').count(), { timeout: 40_000 })
        .toBe(expectedTracks)
      await expect
        .poll(() => ui.page.locator('[data-redencut-busy]').getAttribute('data-redencut-busy'))
        .toBe('false')
    }
    await importAudio(1)
    await ui.call('browser_click', { target: 'button:has-text("Generate")' })
    await ui.call('browser_click', {
      target: 'button:text-is("Start processing")',
    })
    await expect
      .poll(() => ui.page.locator('[data-testid="canonical-transcript"]').count(), {
        timeout: 240_000,
      })
      .toBe(1)
    await importAudio(2, 'mandarin-short-female.m4a')
    await expect.poll(() => ui.page.locator('canvas').count()).toBe(2)
    await ui.call('browser_click', { target: 'button:has-text("Generate")' })
    await ui.call('browser_click', { target: 'button:text-is("Start processing")' })
    const cards = ui.page.getByRole('region', { name: 'Simultaneous speech', exact: true })
    await expect.poll(() => cards.count(), { timeout: 240_000 }).toBeGreaterThan(0)
    const firstCard = cards.first()
    const oldStart = Number(await firstCard.getAttribute('data-overlap-start'))
    const movedClipId = await ui.page.locator('.waveform-clip').nth(1).getAttribute('data-clip-id')
    if (!movedClipId) throw new Error('SECOND_CLIP_MISSING')
    const speech = ui.page.locator('[data-unit-kind="speech"][data-output-start][data-output-end]')
    const readSpeech = () =>
      speech.evaluateAll((nodes) =>
        nodes.map((node) => ({
          id: node.getAttribute('data-occurrence-id')!,
          clip: node.getAttribute('data-clip-id')!,
          track: node.getAttribute('data-track-id')!,
          start: Number(node.getAttribute('data-output-start')),
          end: Number(node.getAttribute('data-output-end')),
        })),
      )
    const beforeSpeech = await readSpeech()
    const movedOccurrence = beforeSpeech.find((unit) => unit.clip === movedClipId)
    if (!movedOccurrence) throw new Error('SECOND_TRACK_SPEECH_MISSING')
    // Occurrence identity remains stable when the clip moves between dialogue blocks.
    const movedSpeech = ui.page.locator(
      `[data-occurrence-id=${JSON.stringify(movedOccurrence.id)}]`,
    )

    await ui.call('browser_click', {
      target: 'section[aria-label="Simultaneous speech"] button:text-is("Align") >> nth=0',
    })
    expect(
      await firstCard
        .getByRole('button', { name: 'Align', exact: true })
        .getAttribute('aria-pressed'),
    ).toBe('true')
    expect(
      new Set(
        await firstCard
          .locator('[data-unit-kind="speech"]')
          .evaluateAll((nodes) => nodes.map((node) => node.getAttribute('data-track-id'))),
      ).size,
    ).toBe(2)
    await ui.screenshot('two-track-alignment')

    const timeline = ui.page.locator('#waveform-timeline')
    const zero = await timeline.getByText('0s', { exact: true }).boundingBox()
    const one = await timeline.getByText('1s', { exact: true }).boundingBox()
    const second = await ui.page.locator('canvas').nth(1).boundingBox()
    if (!zero || !one || !second) throw new Error('VISIBLE_TIMELINE_GEOMETRY_MISSING')
    await ui.call('browser_mouse_drag_xy', {
      startX: second.x + 20,
      startY: second.y + second.height / 2,
      endX: second.x + 20 + 5 * (one.x - zero.x),
      endY: second.y + second.height / 2,
    })
    await expect
      .poll(async () => Number(await movedSpeech.first().getAttribute('data-output-start')))
      .toBeCloseTo(movedOccurrence.start + 5, 1)
    const afterSpeech = await readSpeech()
    const delta =
      afterSpeech.find((unit) => unit.id === movedOccurrence.id)!.start - movedOccurrence.start
    // Independent real analyses may start at different times. The earliest overlap is
    // the first positive intersection, not the previous overlap plus the clip delta.
    const shifted = beforeSpeech.map((unit) => ({
      ...unit,
      start: unit.start + (unit.clip === movedClipId ? delta : 0),
      end: unit.end + (unit.clip === movedClipId ? delta : 0),
    }))
    const intersections = shifted.flatMap((a, index) =>
      shifted.slice(index + 1).flatMap((b) => {
        const start = Math.max(a.start, b.start)
        return a.track !== b.track && start < Math.min(a.end, b.end) ? [start] : []
      }),
    )
    if (intersections.length) {
      const expectedStart = Math.min(...intersections)
      await expect
        .poll(async () => Number(await cards.first().getAttribute('data-overlap-start')))
        .toBeCloseTo(expectedStart, 2)
    } else {
      await expect.poll(() => cards.count()).toBe(0)
    }
    await ui.screenshot('overlap-after-clip-move')
    await ui.call('browser_click', { target: 'button[aria-label="Undo"]' })
    await expect
      .poll(async () => Number(await cards.first().getAttribute('data-overlap-start')))
      .toBeCloseTo(oldStart, 2)
    await expect
      .poll(async () => Number(await movedSpeech.first().getAttribute('data-output-start')))
      .toBeCloseTo(movedOccurrence.start, 2)
    await ui.screenshot('overlap-after-undo')
  } finally {
    await ui.close()
  }
}, 300_000)
