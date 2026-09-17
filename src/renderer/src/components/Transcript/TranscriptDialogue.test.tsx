// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { usePlaybackStore } from '../../stores/playback.store'
import { TranscriptDialogue } from './TranscriptDialogue'
import type { TranscriptOccurrence } from '../../domain/transcriptProjection'
function occurrence(
  id: string,
  track: string,
  start: number,
  end: number,
  text = id,
): TranscriptOccurrence {
  return {
    id,
    scopeId: track,
    track: { id: track, name: track, color: '#fff' },
    unit: { id, text, kind: 'speech' },
    analysis: { speakers: [], speakerLabelOverrides: [] },
    outputStart: start,
    outputEnd: end,
    orderTime: start,
    muted: false,
  } as unknown as TranscriptOccurrence
}
beforeEach(() => usePlaybackStore.getState().reset())
afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})
it('wraps shared measured columns inside each speaker lane and preserves every unit through resize', () => {
  let resize: ((entries: unknown[]) => void) | undefined
  vi.stubGlobal(
    'ResizeObserver',
    class {
      constructor(callback: (entries: unknown[]) => void) {
        resize = callback
      }
      observe() {}
      disconnect() {}
    },
  )
  const units = [
    occurrence('long', 'a', 0, 6, 'A long acoustic phrase'),
    occurrence('one', 'b', 1, 2, 'First interjection'),
    occurrence('two', 'b', 4, 5, 'Second interjection'),
  ]
  render(
    <TranscriptDialogue
      units={units}
      renderUnit={(u) => <span data-rendered-unit={u.id}>{u.unit.text}</span>}
    />,
  )
  fireEvent.click(screen.getByRole('button', { name: 'Align' }))
  act(() => resize?.([{ contentRect: { width: 260 } }]))
  const anchors = [...document.querySelectorAll<HTMLElement>('.transcript-column-time')]
  expect(anchors.length).toBeGreaterThan(0)
  expect(
    anchors.every((anchor) => anchor.textContent === '·' && /^\d+:\d+\.\d+$/.test(anchor.title)),
  ).toBe(true)
  const lanes = document.querySelectorAll('[data-aligned-track]')
  expect([...lanes].map((l) => l.getAttribute('data-aligned-track'))).toEqual(['a', 'b'])
  expect(lanes[0].querySelectorAll('.transcript-content-line').length).toBeGreaterThan(1)
  expect(lanes[1].querySelectorAll('.transcript-content-line').length).toBe(
    lanes[0].querySelectorAll('.transcript-content-line').length,
  )
  expect(
    [...document.querySelectorAll('[data-rendered-unit]')].map((u) =>
      u.getAttribute('data-rendered-unit'),
    ),
  ).toEqual(['long', 'one', 'two'])
  expect(screen.getAllByLabelText('Speech continues').length).toBeGreaterThan(0)
  act(() => resize?.([{ contentRect: { width: 1000 } }]))
  expect(
    document.querySelectorAll('[data-aligned-track="a"] .transcript-content-line'),
  ).toHaveLength(1)
  expect(document.querySelectorAll('[data-rendered-unit]')).toHaveLength(3)
})

it('renders deleted words inline with a single speaker label across audio fragments', () => {
  const units = [0, 1, 2].map(
    (index) =>
      ({
        ...occurrence(`word-${index}`, 'a', index * 0.5, (index + 1) * 0.5),
        scopeId: `clip-${index}`,
        clip: {
          id: `clip-${index}`,
          audioSourceId: 'source',
          sourceStart: index * 0.5,
          sourceEnd: (index + 1) * 0.5,
          outputStart: index * 0.5,
        },
        muted: index === 1,
      }) as TranscriptOccurrence,
  )
  render(
    <TranscriptDialogue
      units={units}
      renderUnit={(u) => (u.muted ? <s>{u.unit.text}</s> : <span>{u.unit.text}</span>)}
    />,
  )
  expect(document.querySelectorAll('.transcript-paragraph')).toHaveLength(1)
  expect(document.querySelectorAll('.transcript-speaker')).toHaveLength(1)
  expect(document.querySelector('.transcript-words')?.textContent).toBe('word-0word-1word-2')
  expect(document.querySelector('s')?.textContent).toBe('word-1')
})

it('renders short boundary context inside the card without marking its time as simultaneous', () => {
  usePlaybackStore.getState().setCurrentTime(8.54)
  const units = [
    occurrence('a', 'a', 6.984, 8.533),
    occurrence('b', 'b', 6.984, 8.533),
    occurrence('tail', 'a', 8.535, 8.555, '楚'),
  ]
  render(<TranscriptDialogue units={units} renderUnit={(u) => <span>{u.unit.text}</span>} />)
  const card = document.querySelector('.transcript-overlap')!
  expect(card.textContent).toContain('楚')
  expect(card.classList.contains('is-live')).toBe(false)
  expect(card.getAttribute('data-overlap-end')).toBe('8.533')
  act(() => usePlaybackStore.getState().setCurrentTime(7))
  expect(card.classList.contains('is-live')).toBe(true)
  act(() => usePlaybackStore.getState().setCurrentTime(8.533))
  expect(card.classList.contains('is-live')).toBe(false)
  fireEvent.click(screen.getByRole('button', { name: 'Align' }))
  act(() => usePlaybackStore.getState().setCurrentTime(7.5))
  expect(card.classList.contains('is-live')).toBe(true)
})

it('renders one reading row across a silent interstitial clip', () => {
  const clips = [0, 1, 2].map((index) => ({
    id: `clip-${index}`,
    audioSourceId: 'source',
    sourceStart: index * 0.3,
    sourceEnd: (index + 1) * 0.3,
    outputStart: index * 0.3,
  }))
  const units = [0, 2].map(
    (index) =>
      ({
        ...occurrence(`word-${index}`, 'a', index * 0.3, (index + 1) * 0.3),
        scopeId: `clip-${index}`,
        clip: clips[index],
      }) as TranscriptOccurrence,
  )
  const tracks = [{ ...units[0].track, clips: clips as TranscriptOccurrence['clip'][] }]
  render(
    <TranscriptDialogue
      units={units}
      tracks={tracks}
      renderUnit={(u) => <span>{u.unit.text}</span>}
    />,
  )
  expect(document.querySelectorAll('.transcript-paragraph')).toHaveLength(1)
  expect(document.querySelector('.transcript-words')?.textContent).toBe('word-0word-2')
})

it('labels unattributed completed diarization as unassigned while skipped analysis uses its source track', () => {
  const base = occurrence('word', 'source track', 0, 1)
  const { rerender } = render(
    <TranscriptDialogue
      units={[{ ...base, analysis: { ...base.analysis, diarizationStatus: 'completed' } }]}
      renderUnit={(u) => <span>{u.unit.text}</span>}
    />,
  )
  expect(document.querySelector('.transcript-speaker > div > span')?.textContent).toBe(
    'Unassigned speaker',
  )
  rerender(
    <TranscriptDialogue
      units={[{ ...base, analysis: { ...base.analysis, diarizationStatus: 'skipped-disabled' } }]}
      renderUnit={(u) => <span>{u.unit.text}</span>}
    />,
  )
  expect(document.querySelector('.transcript-speaker > div > span')?.textContent).toBe(
    'source track',
  )
})
