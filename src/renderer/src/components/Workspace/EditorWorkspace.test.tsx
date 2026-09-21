// @vitest-environment jsdom
import { useEffect } from 'react'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { DEFAULT_WORKSPACE_LAYOUT, type WorkspaceLayout } from '@shared/workspaceLayout.types'
import { useWorkspaceStore } from '../../stores/workspace.store'
import { EditorWorkspace } from './EditorWorkspace'

const update = vi.fn((layout: WorkspaceLayout) => useWorkspaceStore.setState({ layout }))
let resize: () => void
let mounted: string[]
function Feature({ id }: { id: string }) {
  useEffect(() => {
    mounted.push(id)
  }, [id])
  return (
    <div data-testid={id} contentEditable suppressContentEditableWarning>
      {id} editable text
    </div>
  )
}
function setup() {
  render(
    <EditorWorkspace
      transcript={<Feature id="transcript" />}
      audio={<Feature id="audio" />}
      transport={<Feature id="transport" />}
    />,
  )
  const regions = screen.getByRole('region', { name: 'Transcript panel' }).parentElement!
  Object.defineProperty(regions, 'clientHeight', { configurable: true, value: 400 })
  regions.getBoundingClientRect = () => ({
    left: 0,
    right: 900,
    top: 0,
    bottom: 400,
    width: 900,
    height: 400,
    x: 0,
    y: 0,
    toJSON: () => ({}),
  })
  for (const node of screen.getAllByRole('region')) {
    node.getBoundingClientRect = () => {
      const ids = order()
      const index = ids.indexOf(node.getAttribute('data-workspace-panel'))
      const top = index === 0 ? 0 : index === 1 ? 201 : 340
      const height = index === 0 ? 188 : index === 1 ? 126 : 60
      return {
        left: 0,
        right: 900,
        top,
        bottom: top + height,
        width: 900,
        height,
        x: 0,
        y: top,
        toJSON: () => ({}),
      }
    }
  }
  act(() => resize())
  return regions
}
function order() {
  return screen.getAllByRole('region').map((node) => node.getAttribute('data-workspace-panel'))
}
function pointer(target: Window | Element, type: string, x: number, y: number) {
  const event = new MouseEvent(type, { bubbles: true, clientX: x, clientY: y, button: 0 })
  Object.defineProperty(event, 'pointerId', { value: 1 })
  fireEvent(target, event)
}
beforeEach(() => {
  mounted = []
  update.mockClear()
  vi.stubGlobal(
    'ResizeObserver',
    class {
      constructor(callback: () => void) {
        resize = callback
      }
      observe() {}
      disconnect() {}
    },
  )
  useWorkspaceStore.setState({
    layout: DEFAULT_WORKSPACE_LAYOUT,
    hydrated: true,
    saving: false,
    warning: null,
    error: null,
    errorKind: null,
    hydrate: vi.fn(async () => {}),
    updateLayout: update,
    retrySave: vi.fn(),
    resetLayout: () => update(DEFAULT_WORKSPACE_LAYOUT),
  })
})
afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

describe('EditorWorkspace', () => {
  it('changes actual reading order without remounting features and preserves native selection and scroll', () => {
    setup()
    expect(order()).toEqual(['transcript', 'audio', 'transport'])
    const transcript = screen.getByTestId('transcript')
    const text = transcript.firstChild!
    transcript.parentElement!.scrollTop = 72
    window.getSelection()!.setBaseAndExtent(text, 2, text, 8)
    const selected = window.getSelection()!.toString()
    pointer(screen.getByRole('button', { name: 'Drag Transcript panel' }), 'pointerdown', 10, 20)
    pointer(window, 'pointermove', 400, 260)
    pointer(window, 'pointerup', 400, 260)
    expect(order()).toEqual(['audio', 'transcript', 'transport'])
    expect(screen.getByTestId('transcript')).toBe(transcript)
    expect(window.getSelection()!.toString()).toBe(selected)
    expect(transcript.parentElement!.scrollTop).toBe(72)
    pointer(screen.getByRole('button', { name: 'Drag Transport panel' }), 'pointerdown', 10, 390)
    pointer(window, 'pointermove', 400, 30)
    pointer(window, 'pointerup', 400, 30)
    expect(order()).toEqual(['transport', 'audio', 'transcript'])
    expect(mounted).toEqual(['transcript', 'audio', 'transport'])
  })

  it('only starts panel dragging at handles and only commits on visible legal targets', () => {
    setup()
    pointer(screen.getByTestId('transcript'), 'pointerdown', 10, 100)
    expect(document.querySelector('.workspace-drop-overlay')).toBeNull()
    expect(screen.queryByRole('button', { name: /^Move (Audio|Transcript|Transport)/ })).toBeNull()
    const handle = screen.getByRole('button', { name: 'Drag Transcript panel' })
    fireEvent.click(handle)
    expect(update).not.toHaveBeenCalled()
    pointer(handle, 'pointerdown', 10, 20)
    expect(document.querySelector('.workspace-drop-overlay')).toBeNull()
    pointer(window, 'pointerup', 400, 200)
    expect(update).not.toHaveBeenCalled()
    pointer(handle, 'pointerdown', 10, 20)
    pointer(window, 'pointermove', 400, 260)
    expect(update).not.toHaveBeenCalled()
    pointer(window, 'pointermove', 400, 260)
    pointer(window, 'pointerup', 400, 260)
    expect(update).toHaveBeenCalledTimes(1)
    expect(order()[0]).toBe('audio')
  })

  it('ignores a short grab and release even at a legal transport destination', () => {
    setup()
    const handle = screen.getByRole('button', { name: 'Drag Transport panel' })
    pointer(handle, 'pointerdown', 400, 20)
    pointer(window, 'pointermove', 406, 25)
    pointer(window, 'pointerup', 406, 25)
    expect(update).not.toHaveBeenCalled()
    expect(order()).toEqual(['transcript', 'audio', 'transport'])
  })

  it('shows the opposite transport dock before entry and activates it across the workspace width', () => {
    setup()
    pointer(screen.getByRole('button', { name: 'Drag Transport panel' }), 'pointerdown', 10, 390)
    pointer(window, 'pointermove', 10, 300)
    const guide = document.querySelector<HTMLElement>('[data-workspace-drop="upper"]')
    expect(guide).not.toBeNull()
    expect(guide?.getAttribute('data-active')).toBe('false')
    act(() => resize())
    expect(document.querySelector('[data-workspace-drop="upper"]')).not.toBeNull()
    pointer(window, 'pointermove', 0, 30)
    expect(guide?.getAttribute('data-active')).toBe('true')
    pointer(window, 'pointerup', 0, 30)
    expect(order()[0]).toBe('transport')
  })

  it('highlights the full destination immediately but cancels when released in its edge dead zone', () => {
    setup()
    pointer(screen.getByRole('button', { name: 'Drag Transcript panel' }), 'pointerdown', 40, 20)
    pointer(window, 'pointermove', 400, 260)
    const target = document.querySelector<HTMLElement>('[data-workspace-drop="lower"]')!
    expect(target).not.toBeNull()
    expect(target.style.top).toBe('201px')
    expect(target.style.height).toBe('126px')
    pointer(window, 'pointermove', 400, 210)
    expect(document.querySelector('[data-workspace-drop]')).toBeNull()
    pointer(window, 'pointerup', 400, 210)
    expect(update).not.toHaveBeenCalled()
  })

  it.each([0, 10, 890, 900])('accepts drops across the full workspace width at x=%s', (x) => {
    setup()
    pointer(screen.getByRole('button', { name: 'Drag Transcript panel' }), 'pointerdown', 40, 20)
    pointer(window, 'pointermove', x, 260)
    pointer(window, 'pointerup', x, 260)
    expect(order()).toEqual(['audio', 'transcript', 'transport'])
    pointer(screen.getByRole('button', { name: 'Drag Transport panel' }), 'pointerdown', 10, 390)
    pointer(window, 'pointermove', x, 30)
    pointer(window, 'pointerup', x, 30)
    expect(order()).toEqual(['transport', 'audio', 'transcript'])
  })

  it('does not move a panel dropped in its original region or outside the workspace', () => {
    setup()
    for (const [x, y] of [
      [400, 100],
      [901, 260],
      [-1, 260],
    ]) {
      pointer(screen.getByRole('button', { name: 'Drag Transcript panel' }), 'pointerdown', 40, 20)
      pointer(window, 'pointermove', x, y)
      pointer(window, 'pointerup', x, y)
    }
    expect(update).not.toHaveBeenCalled()
  })

  it('cancels dragging and resizing through Escape and pointer cancellation', () => {
    setup()
    pointer(screen.getByRole('button', { name: 'Drag Transport panel' }), 'pointerdown', 10, 390)
    fireEvent.keyDown(window, { key: 'Escape', code: 'Escape' })
    pointer(window, 'pointerup', 10, 10)
    expect(update).not.toHaveBeenCalled()
    const divider = screen.getByRole('separator')
    pointer(divider, 'pointerdown', 10, 200)
    pointer(window, 'pointermove', 10, 250)
    pointer(window, 'pointercancel', 10, 250)
    expect(update).not.toHaveBeenCalled()
    expect(divider.getAttribute('aria-valuenow')).toBe('60')
  })

  it('previews constrained resize locally, saves once at completion and does not save window constraints', () => {
    const regions = setup()
    const divider = screen.getByRole('separator')
    pointer(divider, 'pointerdown', 10, 200)
    pointer(window, 'pointermove', 10, 350)
    expect(update).not.toHaveBeenCalled()
    expect(Number(divider.getAttribute('aria-valuenow'))).toBeLessThanOrEqual(62)
    pointer(window, 'pointerup', 10, 350)
    expect(update).toHaveBeenCalledTimes(1)
    const stored = useWorkspaceStore.getState().layout.transcriptRatio
    Object.defineProperty(regions, 'clientHeight', { configurable: true, value: 328 })
    act(() => resize())
    expect(divider.getAttribute('aria-valuenow')).toBe('50')
    expect(useWorkspaceStore.getState().layout.transcriptRatio).toBe(stored)
    expect(update).toHaveBeenCalledTimes(1)
  })

  it.each(['drag', 'resize'])(
    'cancels an active %s when delayed hydration changes the layout',
    (gesture) => {
      setup()
      const control =
        gesture === 'drag'
          ? screen.getByRole('button', { name: 'Drag Transcript panel' })
          : screen.getByRole('separator')
      pointer(control, 'pointerdown', 10, 200)
      pointer(window, 'pointermove', 10, 390)
      const hydrated: WorkspaceLayout = {
        version: 1,
        contentOrder: ['audio', 'transcript'],
        transcriptRatio: 0.45,
        transportPosition: 'top',
      }
      act(() => useWorkspaceStore.setState({ layout: hydrated }))
      pointer(window, 'pointerup', 10, 390)
      expect(update).not.toHaveBeenCalled()
      expect(useWorkspaceStore.getState().layout).toBe(hydrated)
      expect(document.querySelector('.workspace-drop-overlay')).toBeNull()
    },
  )

  it('reports a failed load without offering to overwrite preferences as a retry', () => {
    setup()
    act(() =>
      useWorkspaceStore.setState({
        error: { reason: 'workspace-load' },
        errorKind: 'load',
      }),
    )
    expect(screen.getByRole('status').textContent).toContain('could not be loaded')
    expect(screen.queryByRole('button', { name: 'Retry layout save' })).toBeNull()
    expect(update).not.toHaveBeenCalled()
  })

  it('leaves project modifier shortcuts available while consuming workspace resize keys', () => {
    setup()
    const handler = vi.fn()
    document.addEventListener('keydown', handler)
    const divider = screen.getByRole('separator')
    fireEvent.keyDown(divider, { key: 's', code: 'KeyS', metaKey: true })
    fireEvent.keyDown(screen.getByRole('button', { name: 'Drag Audio panel' }), {
      key: 'z',
      code: 'KeyZ',
      ctrlKey: true,
    })
    fireEvent.keyDown(screen.getByRole('button', { name: 'Reset layout' }), {
      key: 's',
      code: 'KeyS',
      ctrlKey: true,
    })
    expect(handler).toHaveBeenCalledTimes(3)
    fireEvent.keyDown(divider, { key: 'ArrowUp' })
    expect(handler).toHaveBeenCalledTimes(3)
    document.removeEventListener('keydown', handler)
  })

  it('offers keyboard resizing, reset, and nonmodal retry', () => {
    setup()
    const divider = screen.getByRole('separator')
    fireEvent.keyDown(divider, { key: 'Home' })
    expect(Number(divider.getAttribute('aria-valuenow'))).toBe(38)
    expect(
      parseFloat(
        screen
          .getByRole('region', { name: 'Transcript panel' })
          .style.getPropertyValue('--workspace-panel-height'),
      ),
    ).toBeCloseTo(120)
    expect(
      parseFloat(
        screen
          .getByRole('region', { name: 'Audio panel' })
          .style.getPropertyValue('--workspace-panel-height'),
      ),
    ).toBeCloseTo(194)
    fireEvent.keyDown(divider, { key: 'ArrowDown' })
    expect(Number(divider.getAttribute('aria-valuenow'))).toBe(43)
    fireEvent.click(screen.getByRole('button', { name: 'Reset layout' }))
    expect(useWorkspaceStore.getState().layout).toEqual(DEFAULT_WORKSPACE_LAYOUT)
    act(() =>
      useWorkspaceStore.setState({ error: { reason: 'workspace-save' }, errorKind: 'save' }),
    )
    expect(screen.getByRole('status').textContent).toBe('Workspace layout could not be saved.')
    fireEvent.click(screen.getByRole('button', { name: 'Retry layout save' }))
    expect(useWorkspaceStore.getState().retrySave).toHaveBeenCalledTimes(1)
  })
})
