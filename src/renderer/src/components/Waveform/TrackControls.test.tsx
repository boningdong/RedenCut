// @vitest-environment jsdom
import React, { useState } from 'react'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { TrackLevelControl } from './TrackLevelControl'
import { TrackEffectsMenu } from './TrackEffectsMenu'
import { useLocaleStore } from '../../stores/locale.store'

vi.mock('./UseAnchoredPopover', () => ({ useAnchoredPopover: () => ({ left: 100, top: 50 }) }))
afterEach(() => {
  cleanup()
  useLocaleStore.setState({ resolvedLocale: 'en' })
})
function Level() {
  const [value, setValue] = useState(0)
  const [preview, setPreview] = useState(0)
  const [history, setHistory] = useState<number[]>([])
  return (
    <>
      <TrackLevelControl
        kind="gain"
        name="Mix"
        value={value}
        onPreview={setPreview}
        onCancelPreview={() => setPreview(value)}
        onCommit={(next) => {
          setHistory([...history, value])
          setValue(next)
        }}
      />
      <output data-testid="preview">{preview}</output>
      <output data-testid="saved">{value}</output>
      <output data-testid="history">{history.length}</output>
    </>
  )
}
it('commits a slider drag once and cancels an unfinished gesture with Escape', () => {
  render(<Level />)
  fireEvent.click(screen.getByRole('button', { name: 'Mix gain' }))
  const slider = screen.getByRole('slider')
  fireEvent.pointerDown(slider)
  fireEvent.change(slider, { target: { value: '3' } })
  fireEvent.change(slider, { target: { value: '6' } })
  expect(screen.getByTestId('saved').textContent).toBe('0')
  fireEvent.pointerUp(slider)
  expect(screen.getByTestId('saved').textContent).toBe('6')
  expect(screen.getByTestId('history').textContent).toBe('1')
  fireEvent.pointerDown(slider)
  fireEvent.change(slider, { target: { value: '12' } })
  fireEvent.keyDown(slider, { key: 'Escape' })
  expect(screen.queryByRole('slider')).toBeNull()
  expect(screen.getByTestId('saved').textContent).toBe('6')
  expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Mix gain' }))
})
it('commits keyboard repetition once on release and cancels outside edits', () => {
  render(<Level />)
  fireEvent.click(screen.getByRole('button', { name: 'Mix gain' }))
  const slider = screen.getByRole('slider')
  fireEvent.keyDown(slider, { key: 'ArrowRight' })
  fireEvent.change(slider, { target: { value: '2' } })
  fireEvent.change(slider, { target: { value: '4' } })
  fireEvent.keyUp(slider, { key: 'ArrowRight' })
  expect(screen.getByTestId('history').textContent).toBe('1')
  fireEvent.change(slider, { target: { value: '8' } })
  fireEvent.pointerDown(document.body)
  expect(screen.getByTestId('saved').textContent).toBe('4')
})
it('keeps Normalize checked on reopening and updates effect highlighting when disabled', () => {
  function Effects() {
    const [enabled, setEnabled] = useState(false)
    return (
      <TrackEffectsMenu
        active={enabled}
        normalized={enabled}
        onToggleNormalize={() => setEnabled(!enabled)}
      />
    )
  }
  render(<Effects />)
  const button = screen.getByRole('button', { name: 'Effects' })
  expect(button.querySelector('.track-effects-symbol')?.textContent).toBe('fx')
  expect(button.querySelectorAll('svg')).toHaveLength(1)
  fireEvent.click(button)
  fireEvent.click(screen.getByRole('menuitemcheckbox', { name: 'Normalize' }))
  expect(button.getAttribute('aria-pressed')).toBe('true')
  fireEvent.keyDown(screen.getByRole('menu'), { key: 'Escape' })
  fireEvent.click(button)
  expect(screen.getByRole('menuitemcheckbox').getAttribute('aria-checked')).toBe('true')
  fireEvent.click(screen.getByRole('menuitemcheckbox'))
  expect(button.getAttribute('aria-pressed')).toBe('false')
  act(() => useLocaleStore.setState({ resolvedLocale: 'zh-CN' }))
  expect(screen.getByRole('button', { name: '效果' })).toBeTruthy()
})

it('routes header effects and levels through undoable track edits and preserves context actions', async () => {
  const { TrackHeader } = await import('./TrackHeader')
  const { useTimelineStore } = await import('../../stores/TimelineStore')
  useTimelineStore.getState().loadFromProject(
    [],
    [
      {
        id: 'mix',
        name: 'Mix',
        color: '#aaa',
        clips: [],
        effects: [],
        muted: false,
        solo: false,
        volume: 1,
      },
    ],
  )
  function Header() {
    const track = useTimelineStore((state) => state.tracks[0])
    return (
      <TrackHeader
        track={track}
        onRemove={() => useTimelineStore.getState().removeTrack(track.id)}
      />
    )
  }
  render(<Header />)
  fireEvent.click(screen.getByRole('button', { name: 'Effects' }))
  fireEvent.click(screen.getByRole('menuitemcheckbox'))
  fireEvent.keyDown(screen.getByRole('menu'), { key: 'Escape' })
  fireEvent.click(screen.getByRole('button', { name: 'Mix gain' }))
  const slider = screen.getByRole('slider')
  fireEvent.pointerDown(slider)
  fireEvent.change(slider, { target: { value: '3' } })
  fireEvent.change(slider, { target: { value: '6' } })
  fireEvent.pointerUp(slider)
  fireEvent.keyDown(slider, { key: 'Escape' })
  await act(() => useTimelineStore.getState().undo())
  expect(useTimelineStore.getState().tracks[0].gainDb ?? 0).toBe(0)
  expect(screen.getByRole('button', { name: 'Effects' }).getAttribute('aria-pressed')).toBe('true')
  fireEvent.keyDown(screen.getByLabelText('Mix track actions'), { key: 'F10', shiftKey: true })
  expect(screen.getByRole('menuitem', { name: 'Remove track' })).toBeTruthy()
})

it('commits typed gain once on Enter or blur, rejects invalid levels, and cancels with Escape', () => {
  render(<Level />)
  fireEvent.click(screen.getByRole('button', { name: 'Mix gain' }))
  const input = screen.getByRole('spinbutton', { name: 'Mix gain' })
  fireEvent.change(input, { target: { value: '-3.5' } })
  expect(screen.getByTestId('saved').textContent).toBe('0')
  fireEvent.keyDown(input, { key: 'Enter' })
  fireEvent.blur(input)
  expect(screen.getByTestId('saved').textContent).toBe('-3.5')
  expect(screen.getByTestId('history').textContent).toBe('1')
  fireEvent.change(input, { target: { value: '8' } })
  fireEvent.blur(input)
  expect(screen.getByTestId('saved').textContent).toBe('8')
  for (const invalid of ['25', '-25', '']) {
    fireEvent.change(input, { target: { value: invalid } })
    fireEvent.blur(input)
    expect((input as HTMLInputElement).value).toBe('8')
    expect(screen.getByTestId('history').textContent).toBe('2')
  }
  fireEvent.change(input, { target: { value: '12' } })
  fireEvent.keyDown(input, { key: 'Escape' })
  expect(screen.queryByRole('spinbutton')).toBeNull()
  expect(screen.getByTestId('saved').textContent).toBe('8')
  expect(screen.getByTestId('history').textContent).toBe('2')
})

it('commits a valid typed gain when clicking outside the popover', () => {
  render(<Level />)
  fireEvent.click(screen.getByRole('button', { name: 'Mix gain' }))
  fireEvent.change(screen.getByRole('spinbutton'), { target: { value: '-6' } })
  fireEvent.pointerDown(document.body)
  expect(screen.queryByRole('dialog')).toBeNull()
  expect(screen.getByTestId('saved').textContent).toBe('-6')
  expect(screen.getByTestId('history').textContent).toBe('1')
})

it('exposes visible removal without activating the track', async () => {
  const { TrackHeader } = await import('./TrackHeader')
  const { useTimelineStore } = await import('../../stores/TimelineStore')
  const track = {
    id: 'delete-me',
    name: 'Guest',
    color: '#aa6677',
    clips: [],
    effects: [],
    muted: false,
    solo: false,
    volume: 1,
  }
  useTimelineStore.getState().loadFromProject([], [track])
  useTimelineStore.setState({ selectedTrackId: null })
  render(
    <TrackHeader track={track} onRemove={(id) => useTimelineStore.getState().removeTrack(id)} />,
  )
  const activations: Array<string | null> = []
  const unsubscribe = useTimelineStore.subscribe((state) => activations.push(state.selectedTrackId))
  fireEvent.click(screen.getByRole('button', { name: 'Remove Guest' }))
  unsubscribe()
  expect(activations).not.toContain(track.id)
  expect(useTimelineStore.getState().tracks).toHaveLength(0)
  expect(useTimelineStore.getState().selectedTrackId).toBeNull()
})

it('auditions sliders while dragging without saving and restores sound on cancellation', () => {
  render(<Level />)
  fireEvent.click(screen.getByRole('button', { name: 'Mix gain' }))
  const slider = screen.getByRole('slider')
  fireEvent.pointerDown(slider)
  fireEvent.change(slider, { target: { value: '-12' } })
  expect(screen.getByTestId('preview').textContent).toBe('-12')
  expect(screen.getByTestId('saved').textContent).toBe('0')
  expect(screen.getByTestId('history').textContent).toBe('0')
  fireEvent.keyDown(slider, { key: 'Escape' })
  expect(screen.getByTestId('preview').textContent).toBe('0')
})

it('clears an audition when a drag returns to its original gain without creating history', () => {
  const onCommit = vi.fn()
  const onCancelPreview = vi.fn()
  render(
    <TrackLevelControl
      kind="gain"
      name="Mix"
      value={0}
      onCommit={onCommit}
      onCancelPreview={onCancelPreview}
    />,
  )
  fireEvent.click(screen.getByRole('button', { name: 'Mix gain' }))
  const slider = screen.getByRole('slider')
  fireEvent.change(slider, { target: { value: '6' } })
  fireEvent.change(slider, { target: { value: '0' } })
  fireEvent.pointerUp(slider)
  expect(onCommit).not.toHaveBeenCalled()
  expect(onCancelPreview).toHaveBeenCalledOnce()
})
