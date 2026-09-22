// @vitest-environment jsdom
import { fireEvent, render, screen, cleanup } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { ProjectMenu } from './ProjectMenu'
afterEach(cleanup)
it('opens project commands from the name and returns focus on Escape', () => {
  const command = vi.fn()
  render(<ProjectMenu name="Episode" disabled={false} onCommand={command} />)
  const trigger = screen.getByRole('button', { name: /Episode/ })
  trigger.focus()
  fireEvent.click(trigger)
  fireEvent.keyDown(screen.getByRole('menu'), { key: 'Escape' })
  expect(document.activeElement).toBe(trigger)
  expect(command).not.toHaveBeenCalled()
  fireEvent.click(trigger)
  fireEvent.click(screen.getByRole('menuitem', { name: 'New Project' }))
  expect(command).toHaveBeenCalledWith('new')
})
