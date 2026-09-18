// @vitest-environment jsdom
import { useState } from 'react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { PreferencesDialog } from './PreferencesDialog'

beforeEach(() => {
  HTMLDialogElement.prototype.showModal = function () {
    this.open = true
  }
  HTMLDialogElement.prototype.close = function () {
    this.open = false
  }
})
afterEach(cleanup)

function Fixture({ backgroundKeyDown = () => {} }: { backgroundKeyDown?: () => void }) {
  const [open, setOpen] = useState(true)
  return (
    <div onKeyDown={backgroundKeyDown}>
      {open && (
        <PreferencesDialog label="Preferences" onClose={() => setOpen(false)}>
          <button>Validate</button>
          <button onKeyDown={(event) => event.preventDefault()}>Consumed</button>
          <button onKeyDown={(event) => event.stopPropagation()}>Nested menu</button>
          <select aria-label="Language" defaultValue="en">
            <option value="en">English</option>
          </select>
        </PreferencesDialog>
      )}
    </div>
  )
}

it('closes on Escape from a focused Validate button without invoking background shortcuts', () => {
  const backgroundKeyDown = vi.fn()
  render(<Fixture backgroundKeyDown={backgroundKeyDown} />)
  const validate = screen.getByRole('button', { name: 'Validate' })
  validate.focus()
  expect(fireEvent.keyDown(validate, { key: 'Escape' })).toBe(false)
  expect(screen.queryByRole('dialog')).toBeNull()
  expect(backgroundKeyDown).not.toHaveBeenCalled()
})

it.each(['Consumed', 'Nested menu'])('leaves Escape consumed by %s within its control', (name) => {
  render(<Fixture />)
  fireEvent.keyDown(screen.getByRole('button', { name }), { key: 'Escape' })
  expect(screen.getByRole('dialog')).toBeTruthy()
})

it('does not close during IME composition or intercept non-Escape keys', () => {
  const backgroundKeyDown = vi.fn()
  render(<Fixture backgroundKeyDown={backgroundKeyDown} />)
  const validate = screen.getByRole('button', { name: 'Validate' })
  expect(fireEvent.keyDown(validate, { key: 'Escape', isComposing: true })).toBe(true)
  expect(fireEvent.keyDown(validate, { key: ' ' })).toBe(true)
  expect(screen.getByRole('dialog')).toBeTruthy()
  expect(backgroundKeyDown).not.toHaveBeenCalled()
})

it('leaves Escape on a native select to its native control', () => {
  render(<Fixture />)
  const select = screen.getByRole('combobox')
  select.focus()
  expect(fireEvent.keyDown(select, { key: 'Escape' })).toBe(true)
  expect(screen.getByRole('dialog')).toBeTruthy()
})

it('still handles native dialog cancel requests', () => {
  render(<Fixture />)
  expect(fireEvent(screen.getByRole('dialog'), new Event('cancel', { cancelable: true }))).toBe(
    false,
  )
  expect(screen.queryByRole('dialog')).toBeNull()
})
