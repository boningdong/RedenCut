// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { useEditorStore } from '../stores/editor.store'
import { useTimelineStore } from '../stores/timeline.store'
import { useTranscriptStore } from '../stores/transcript.store'
import { useKeyboardShortcuts } from './useKeyboardShortcuts'

const clipboardActions = vi.hoisted(() => ({
  copyClips: vi.fn(() => true),
  cutClips: vi.fn(() => true),
  pasteClips: vi.fn(() => true),
  duplicateClips: vi.fn(() => true),
}))
vi.mock('../actions/ClipClipboardActions', () => clipboardActions)

const player = vi.hoisted(() => ({
  isPlaying: () => true,
  getCurrentTime: () => 2,
  playPause: vi.fn(async () => {}),
}))
vi.mock('@shared/player.types', () => ({ getAudioPlayerInstance: () => player }))
afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

function Controls({ onSave }: { onSave?: () => void } = {}) {
  useKeyboardShortcuts({ onSave })
  return (
    <>
      <div className="audio-panel-view">
        <input aria-label="Name" />
        <div tabIndex={0}>Audio editor</div>
      </div>
      <div contentEditable suppressContentEditableWarning data-testid="transcript">
        Transcript
      </div>
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

beforeEach(() => {
  useEditorStore.getState().reset()
  useTranscriptStore.getState().reset()
  useTimelineStore.getState().reset()
  useTimelineStore.setState({
    tracks: [
      {
        id: 'track',
        name: 'Track',
        color: '#fff',
        volume: 1,
        muted: false,
        solo: false,
        effects: [],
        clips: [
          {
            id: 'clip',
            trackId: 'track',
            audioSourceId: 'source' as never,
            sourceStart: 0,
            sourceEnd: 4,
            outputStart: 0,
            gain: 1,
            muted: false,
            effects: [],
          },
        ],
      },
    ],
    selectedClipId: 'clip',
  })
})

it.each(['metaKey', 'ctrlKey'])(
  'runs project save and history from transcript focus with %s',
  (modifier) => {
    const save = vi.fn()
    render(<Controls onSave={save} />)
    const transcript = screen.getByTestId('transcript')
    Object.defineProperty(transcript, 'isContentEditable', { value: true })
    useTimelineStore.getState().splitAt(2)
    expect(useTimelineStore.getState().tracks[0].clips).toHaveLength(2)
    fireEvent.keyDown(transcript, { key: 'z', code: 'KeyZ', [modifier]: true })
    expect(useTimelineStore.getState().tracks[0].clips).toHaveLength(1)
    fireEvent.keyDown(transcript, { key: 'Z', code: 'KeyZ', [modifier]: true, shiftKey: true })
    expect(useTimelineStore.getState().tracks[0].clips).toHaveLength(2)
    fireEvent.keyDown(transcript, { key: 's', code: 'KeyS', [modifier]: true })
    expect(save).toHaveBeenCalledOnce()
  },
)

it('leaves real text input and composition shortcuts to the browser', () => {
  const save = vi.fn()
  render(<Controls onSave={save} />)
  useTimelineStore.getState().splitAt(2)
  fireEvent.keyDown(screen.getByRole('textbox'), { key: 'z', code: 'KeyZ', ctrlKey: true })
  fireEvent.keyDown(screen.getByText('Editor'), {
    key: 'z',
    code: 'KeyZ',
    ctrlKey: true,
    isComposing: true,
  })
  fireEvent.keyDown(screen.getByText('Editor'), {
    key: 'z',
    code: 'KeyZ',
    ctrlKey: true,
    altKey: true,
  })
  expect(useTimelineStore.getState().tracks[0].clips).toHaveLength(2)
  fireEvent.keyDown(screen.getByRole('textbox'), { key: 's', code: 'KeyS', metaKey: true })
  expect(save).not.toHaveBeenCalled()
})

it.each(['KeyM', 'KeyS', 'KeyU', 'Delete'])(
  'does not reinterpret transcript selection as waveform %s after focus moves',
  (code) => {
    render(<Controls />)
    act(() => {
      useTranscriptStore.getState().setSelectedTranscriptUnitIds(new Set(['word']))
      useEditorStore
        .getState()
        .setSelection({ origin: 'transcript', trackId: 'track', start: 1, end: 2 })
    })
    const before = useTimelineStore.getState().tracks
    fireEvent.keyDown(screen.getByText('Editor'), {
      key: code === 'Delete' ? 'Delete' : code.slice(-1).toLowerCase(),
      code,
    })
    expect(useTimelineStore.getState().tracks).toBe(before)
    expect(useTimelineStore.getState().undoStack).toHaveLength(0)
  },
)

it.each([
  ['KeyC', 'copyClips', 'ctrlKey'],
  ['KeyX', 'cutClips', 'metaKey'],
  ['KeyV', 'pasteClips', 'ctrlKey'],
  ['KeyD', 'duplicateClips', 'metaKey'],
] as const)('routes %s to clipboard actions from Audio focus', (code, action, modifier) => {
  render(<Controls />)
  const event = new KeyboardEvent('keydown', {
    key: code.slice(-1).toLowerCase(),
    code,
    [modifier]: true,
    bubbles: true,
    cancelable: true,
  })

  fireEvent(screen.getByText('Audio editor'), event)

  expect(event.defaultPrevented).toBe(true)
  expect(clipboardActions[action]).toHaveBeenCalledOnce()
})

it('unmutes the complete selected clip batch with U', () => {
  useTimelineStore.setState((state) => ({
    tracks: state.tracks.map((track) => ({
      ...track,
      clips: [
        ...track.clips.map((clip) => ({ ...clip, muted: true })),
        { ...track.clips[0], id: 'clip-b', outputStart: 5, muted: true },
      ],
    })),
    selectedClipIds: ['clip', 'clip-b'],
    selectedClipId: 'clip',
  }))
  render(<Controls />)

  fireEvent.keyDown(screen.getByText('Audio editor'), { key: 'u', code: 'KeyU' })

  expect(useTimelineStore.getState().tracks[0].clips.map((clip) => clip.muted)).toEqual([
    false,
    false,
  ])
  expect(useTimelineStore.getState().undoStack).toHaveLength(1)
})

it('leaves clipboard chords native outside Audio focus and in editable content', () => {
  render(<Controls />)
  const transcript = screen.getByTestId('transcript')
  Object.defineProperty(transcript, 'isContentEditable', { value: true })

  const outside = new KeyboardEvent('keydown', {
    key: 'c',
    code: 'KeyC',
    metaKey: true,
    bubbles: true,
    cancelable: true,
  })
  fireEvent(screen.getByText('Editor'), outside)
  fireEvent.keyDown(screen.getByRole('textbox'), { key: 'x', code: 'KeyX', metaKey: true })
  fireEvent.keyDown(transcript, { key: 'v', code: 'KeyV', metaKey: true })

  expect(outside.defaultPrevented).toBe(false)
  expect(clipboardActions.copyClips).not.toHaveBeenCalled()
  expect(clipboardActions.cutClips).not.toHaveBeenCalled()
  expect(clipboardActions.pasteClips).not.toHaveBeenCalled()
})

it('does not run Audio clipboard actions while a transcript selection remains active', () => {
  render(<Controls />)
  act(() => {
    useTranscriptStore.getState().setSelectedTranscriptUnitIds(new Set(['word']))
  })
  const event = new KeyboardEvent('keydown', {
    key: 'x',
    code: 'KeyX',
    metaKey: true,
    bubbles: true,
    cancelable: true,
  })

  fireEvent(screen.getByText('Audio editor'), event)

  expect(event.defaultPrevented).toBe(false)
  expect(clipboardActions.cutClips).not.toHaveBeenCalled()
})
