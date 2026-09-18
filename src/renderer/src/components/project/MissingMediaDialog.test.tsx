// @vitest-environment jsdom
import { render, screen, fireEvent, cleanup, waitFor, act } from '@testing-library/react'
import { afterEach, beforeEach, it, expect, vi } from 'vitest'
import { MissingMediaDialog } from './MissingMediaDialog'
import { useMediaRecoveryStore } from '../../stores/MediaRecoveryStore'
import type { MediaRecoverySnapshot } from '@shared/MediaRecoveryTypes'
const snapshot: MediaRecoverySnapshot = {
  recoveryId: 'recovery',
  revision: 1,
  projectDisplayName: 'Episode.redencut',
  status: 'active',
  items: [
    {
      audioSourceId: 'source' as never,
      displayName: 'voice.wav',
      byteLength: 1024,
      metadata: {
        sampleRate: 48000,
        channels: 2,
        durationSeconds: 10,
        codec: 'wav',
        bitrateKbps: 768,
      },
      state: { status: 'missing' },
    },
  ],
}
beforeEach(() => {
  HTMLDialogElement.prototype.showModal = function () {
    this.open = true
  }
  HTMLDialogElement.prototype.close = function () {
    this.open = false
  }
  Object.defineProperty(window, 'electronAPI', {
    configurable: true,
    value: {
      mediaRecovery: {
        locate: vi.fn(async () => {}),
        continue: vi.fn(async () => {}),
        cancel: vi.fn(async () => {}),
      },
    },
  })
  useMediaRecoveryStore.setState({ snapshot: structuredClone(snapshot) })
})
afterEach(cleanup)
it('shows missing originals and disables opening until restored', async () => {
  render(<MissingMediaDialog />)
  expect(screen.getByText('voice.wav')).toBeTruthy()
  expect((screen.getByRole('button', { name: 'Open project' }) as HTMLButtonElement).disabled).toBe(
    true,
  )
  fireEvent.click(screen.getByRole('button', { name: 'Choose file…' }))
  await waitFor(() =>
    expect(window.electronAPI.mediaRecovery.locate).toHaveBeenCalledWith({
      recoveryId: 'recovery',
      audioSourceId: 'source',
    }),
  )
  fireEvent.click(screen.getByRole('button', { name: 'Cancel opening' }))
  await waitFor(() =>
    expect(window.electronAPI.mediaRecovery.cancel).toHaveBeenCalledWith({
      recoveryId: 'recovery',
    }),
  )
})
it('shows retry on mismatch and permits explicit open after restoration', () => {
  useMediaRecoveryStore.setState({
    snapshot: {
      ...snapshot,
      items: [{ ...snapshot.items[0], state: { status: 'failed', reason: 'content-mismatch' } }],
    },
  })
  const view = render(<MissingMediaDialog />)
  expect(screen.getByRole('button', { name: 'Choose again…' })).toBeTruthy()
  view.unmount()
  useMediaRecoveryStore.setState({
    snapshot: { ...snapshot, items: [{ ...snapshot.items[0], state: { status: 'restored' } }] },
  })
  render(<MissingMediaDialog />)
  expect((screen.getByRole('button', { name: 'Open project' }) as HTMLButtonElement).disabled).toBe(
    false,
  )
})

it('keeps keyboard focus inside the dialog when a restored file removes its choose button', () => {
  render(<MissingMediaDialog />)
  screen.getByRole('button', { name: 'Choose file…' }).focus()
  act(() =>
    useMediaRecoveryStore.setState({
      snapshot: {
        ...snapshot,
        revision: 2,
        items: [{ ...snapshot.items[0], state: { status: 'restored' } }],
      },
    }),
  )
  expect(screen.getByRole('dialog').contains(document.activeElement)).toBe(true)
})
