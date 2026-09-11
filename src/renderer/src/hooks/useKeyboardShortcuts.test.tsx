// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { useKeyboardShortcuts } from './useKeyboardShortcuts'

const player = vi.hoisted(() => ({ isPlaying: () => true, playPause: vi.fn(async () => {}) }))
vi.mock('@shared/player.types', () => ({ getAudioPlayerInstance: () => player }))
afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

function Controls() {
  useKeyboardShortcuts()
  return (
    <>
      <button>Undo</button>
      <details>
        <summary>Audio details</summary>Metadata
      </details>
      <select aria-label="Mode">
        <option>One</option>
      </select>
      <div tabIndex={0}>Editor</div>
    </>
  )
}

it.each(['Undo', 'Audio details', 'Mode'])(
  'preserves native Space activation on %s without playback',
  (name) => {
    render(<Controls />)
    const control = name === 'Mode' ? screen.getByRole('combobox') : screen.getByText(name)
    control.focus()
    const event = new KeyboardEvent('keydown', {
      code: 'Space',
      key: ' ',
      bubbles: true,
      cancelable: true,
    })
    fireEvent(control, event)
    expect(event.defaultPrevented).toBe(false)
    expect(player.playPause).not.toHaveBeenCalled()
  },
)

it('retains Space playback on the editor surface', () => {
  render(<Controls />)
  const event = new KeyboardEvent('keydown', {
    code: 'Space',
    key: ' ',
    bubbles: true,
    cancelable: true,
  })
  fireEvent(screen.getByText('Editor'), event)
  expect(event.defaultPrevented).toBe(true)
  expect(player.playPause).toHaveBeenCalledOnce()
})
