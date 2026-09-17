// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, within, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { SpeakerIdentityControls } from './SpeakerIdentityControls'
import { useLocaleStore } from '../../stores/locale.store'
import type { Track } from '@shared/project.types'
import type { SpeakerIdentityCatalog } from '@shared/SpeakerIdentityTypes'
import type { RendererSpeechAnalysis } from '@shared/speech.types'
const catalog = {
  version: 1,
  people: ['Alice', 'Bob', 'Cara'].map((displayName, i) => ({
    id: displayName,
    displayName,
    color: ['#dc8b9c', '#88c9c0', '#c4b0df'][i],
    binding: {
      audioSourceId: `00000000-0000-4000-8000-00000000000${i}`,
      analysisRevisionId: '00000000-0000-4000-8000-000000000010',
      speakerId: '00000000-0000-4000-8000-000000000020',
    },
  })),
  associations: [],
} as unknown as SpeakerIdentityCatalog
const analyses = catalog.people.map((p) => ({
  ...p.binding,
  diarizationStatus: 'completed',
  speakers: [{ id: p.binding.speakerId }],
})) as unknown as RendererSpeechAnalysis[]
const presentTracks = catalog.people.map((person, i) => ({
  id: `track-${i}`,
  name: `Track ${i + 1}`,
  color: person.color,
  clips: [{ audioSourceId: person.binding.audioSourceId }],
})) as unknown as Track[]
beforeEach(() => useLocaleStore.setState({ resolvedLocale: 'en' }))
afterEach(cleanup)
function setup(value = catalog) {
  const onSave = vi
    .fn<(value: SpeakerIdentityCatalog) => Promise<void>>()
    .mockResolvedValue(undefined)
  render(
    <SpeakerIdentityControls
      catalog={value}
      analyses={analyses}
      tracks={presentTracks}
      hiddenSpeakerKeys={[]}
      onTogglePeople={vi.fn()}
      onSave={onSave}
    />,
  )
  return onSave
}
it('keeps name and membership drafts atomic and discards cancel', () => {
  const save = setup()
  fireEvent.click(screen.getByRole('button', { name: 'Edit Alice' }))
  const dialog = screen.getByRole('dialog')
  fireEvent.change(within(dialog).getByRole('textbox', { name: 'Name' }), {
    target: { value: 'Alicia' },
  })
  fireEvent.click(within(dialog).getByRole('button', { name: 'Add person' }))
  fireEvent.click(within(dialog).getByRole('button', { name: 'Add Bob' }))
  expect(within(dialog).queryByRole('button', { name: 'Add Bob' })).toBeNull()
  fireEvent.click(within(dialog).getAllByRole('button', { name: 'Cancel' })[1])
  expect(save).not.toHaveBeenCalled()
  expect(screen.queryByRole('dialog')).toBeNull()
})
it('saves inline member edits together and shows one palette for basic Hex', async () => {
  const value = {
    ...catalog,
    associations: [
      {
        id: 'g',
        displayName: 'Guests',
        color: { mode: 'automatic' as const },
        memberPersonIds: ['Alice', 'Bob'],
      },
    ],
  }
  const save = setup(value)
  fireEvent.click(screen.getByRole('button', { name: 'Edit Guests' }))
  const dialog = screen.getByRole('dialog')
  fireEvent.click(within(dialog).getByRole('button', { name: 'Hex' }))
  expect(within(dialog).getAllByRole('button', { name: 'Use #dc8b9c' })).toHaveLength(1)
  fireEvent.doubleClick(within(dialog).getByRole('button', { name: 'Rename Bob' }))
  fireEvent.change(within(dialog).getByRole('textbox', { name: 'Rename Bob' }), {
    target: { value: 'Robert' },
  })
  fireEvent.click(within(dialog).getByRole('button', { name: 'Save' }))
  await waitFor(() => expect(save).toHaveBeenCalledTimes(1))
  expect(save.mock.calls[0][0].people.find((p) => p.id === 'Bob')!.displayName).toBe('Robert')
  expect(save.mock.calls[0][0].associations[0].displayName).toBe('Guests')
})
it('management tree shows each person once with associated children collapsed', () => {
  setup({
    ...catalog,
    associations: [
      {
        id: 'g',
        displayName: 'Guests',
        color: { mode: 'automatic' },
        memberPersonIds: ['Alice', 'Bob'],
      },
    ],
  })
  fireEvent.click(screen.getByRole('button', { name: 'Manage people' }))
  const tree = screen.getByRole('tree')
  expect(within(tree).queryByText('Alice')).toBeNull()
  fireEvent.click(within(tree).getByRole('button', { name: 'Expand Guests' }))
  expect(within(tree).getAllByText('Alice')).toHaveLength(1)
  expect(within(tree).getAllByText('Cara')).toHaveLength(1)
})
it('keeps stale people in management but excludes them from editing and linking', () => {
  const stale = {
    ...catalog.people[2],
    binding: {
      ...catalog.people[2].binding,
      analysisRevisionId:
        '00000000-0000-4000-8000-000000000099' as (typeof catalog.people)[2]['binding']['analysisRevisionId'],
    },
  }
  setup({ ...catalog, people: [...catalog.people.slice(0, 2), stale] })
  expect(screen.queryByRole('button', { name: 'Show Cara' })).toBeNull()
  fireEvent.click(screen.getByRole('button', { name: 'Manage people' }))
  fireEvent.click(within(screen.getByRole('tree')).getByRole('button', { name: 'Edit Cara' }))
  expect(
    (within(screen.getByRole('dialog')).getByRole('button', { name: 'Save' }) as HTMLButtonElement)
      .disabled,
  ).toBe(true)
  expect(
    screen.getByText('Recognition has changed. These historical identities are read-only.'),
  ).toBeTruthy()
})
it('routes tag visibility to all members and drop keeps the receiving name', async () => {
  const save = vi
    .fn<(value: SpeakerIdentityCatalog) => Promise<void>>()
    .mockResolvedValue(undefined)
  const toggle = vi.fn()
  render(
    <SpeakerIdentityControls
      catalog={catalog}
      analyses={analyses}
      tracks={presentTracks}
      hiddenSpeakerKeys={[]}
      onSave={save}
      onTogglePeople={toggle}
    />,
  )
  fireEvent.click(screen.getByRole('button', { name: 'Show Alice' }))
  expect(toggle).toHaveBeenCalledWith(['Alice'])
  const dataTransfer = { setData: vi.fn(), effectAllowed: '', dropEffect: '' }
  fireEvent.dragStart(screen.getByRole('button', { name: 'Show Bob' }).parentElement!, {
    dataTransfer,
  })
  fireEvent.drop(screen.getByRole('button', { name: 'Show Alice' }).parentElement!, {
    dataTransfer,
  })
  await waitFor(() => expect(save).toHaveBeenCalledTimes(1))
  expect(save.mock.calls[0][0].associations[0]).toMatchObject({
    displayName: 'Alice',
    memberPersonIds: ['Alice', 'Bob'],
  })
})
it('keeps one portal clamped and preserves drafts when unrelated people arrive', async () => {
  const save = vi
    .fn<(value: SpeakerIdentityCatalog) => Promise<void>>()
    .mockResolvedValue(undefined)
  const props = {
    catalog,
    analyses,
    tracks: presentTracks,
    hiddenSpeakerKeys: [],
    onTogglePeople: vi.fn(),
    onSave: save,
  }
  const view = render(<SpeakerIdentityControls {...props} />)
  const anchor = screen.getByRole('button', { name: 'Edit Alice' })
  vi.spyOn(anchor, 'getBoundingClientRect').mockReturnValue({ left: 2000, bottom: 2000 } as DOMRect)
  fireEvent.click(anchor)
  expect(screen.getAllByRole('dialog')).toHaveLength(1)
  const dialog = screen.getByRole('dialog')
  expect(dialog.parentElement).toBe(document.body)
  expect(parseInt(dialog.style.left)).toBeLessThan(window.innerWidth)
  fireEvent.change(within(dialog).getByRole('textbox', { name: 'Name' }), {
    target: { value: 'Alicia' },
  })
  const newcomer = {
    ...catalog.people[0],
    id: 'D',
    displayName: 'D',
    binding: {
      ...catalog.people[0].binding,
      audioSourceId:
        '00000000-0000-4000-8000-000000000088' as (typeof catalog.people)[0]['binding']['audioSourceId'],
    },
  }
  view.rerender(
    <SpeakerIdentityControls
      {...props}
      catalog={{ ...catalog, people: [...catalog.people, newcomer] }}
    />,
  )
  expect((within(dialog).getByRole('textbox', { name: 'Name' }) as HTMLInputElement).value).toBe(
    'Alicia',
  )
  fireEvent.click(within(dialog).getByRole('button', { name: 'Save' }))
  await waitFor(() => expect(save).toHaveBeenCalledTimes(1))
  expect(save.mock.calls[0][0].people.map((p) => p.displayName)).toEqual([
    'Alicia',
    'Bob',
    'Cara',
    'D',
  ])
})
it('person member removal immediately removes the row and clearing A preserves B/C', async () => {
  const value = {
    ...catalog,
    associations: [
      {
        id: 'g',
        displayName: 'Guests',
        color: { mode: 'automatic' as const },
        memberPersonIds: ['Alice', 'Bob', 'Cara'],
      },
    ],
  }
  const save = setup(value)
  fireEvent.click(screen.getByRole('button', { name: 'Manage people' }))
  fireEvent.click(screen.getByRole('button', { name: 'Expand Guests' }))
  fireEvent.click(screen.getByRole('button', { name: 'Edit Alice' }))
  const dialog = screen.getByRole('dialog')
  expect(within(dialog).queryByRole('button', { name: 'Remove Alice' })).toBeNull()
  fireEvent.click(within(dialog).getByRole('button', { name: 'Remove Bob' }))
  expect(within(dialog).queryByRole('button', { name: 'Rename Bob' })).toBeNull()
  fireEvent.click(within(dialog).getByRole('button', { name: 'Remove Cara' }))
  fireEvent.click(within(dialog).getByRole('button', { name: 'Save' }))
  await waitFor(() => expect(save).toHaveBeenCalledTimes(1))
  expect(save.mock.calls[0][0].associations[0].memberPersonIds).toEqual(['Bob', 'Cara'])
})
it('shows every matching track badge without choosing one ambiguous source', () => {
  const tracks = [0, 1].map((i) => ({
    id: `t${i}`,
    name: `Long track ${i}`,
    color: '#88c9c0',
    clips: [{ audioSourceId: catalog.people[0].binding.audioSourceId }],
  })) as unknown as Track[]
  render(
    <SpeakerIdentityControls
      catalog={catalog}
      analyses={analyses}
      tracks={tracks}
      hiddenSpeakerKeys={[]}
      onTogglePeople={vi.fn()}
      onSave={vi.fn()}
    />,
  )
  const tag = screen.getByRole('button', { name: 'Show Alice' })
  expect(within(tag).getByText('T1')).toBeTruthy()
  expect(within(tag).getByText('T2')).toBeTruthy()
  expect(screen.queryByText('Long track 0')).toBeNull()
})
it('keyboard activation opens member rename and member color remains a draft', async () => {
  const save = setup({
    ...catalog,
    associations: [
      {
        id: 'g',
        displayName: 'Guests',
        color: { mode: 'custom', value: '#dc8b9c' },
        memberPersonIds: ['Alice', 'Bob'],
      },
    ],
  })
  fireEvent.click(screen.getByRole('button', { name: 'Edit Guests' }))
  const dialog = screen.getByRole('dialog')
  fireEvent.keyDown(within(dialog).getByRole('button', { name: 'Rename Bob' }), { key: 'Enter' })
  expect(within(dialog).getByRole('textbox', { name: 'Rename Bob' })).toBeTruthy()
  fireEvent.click(within(dialog).getByRole('button', { name: 'Color for Bob' }))
  fireEvent.click(within(dialog).getAllByRole('button', { name: 'Use #e0ad88' })[1])
  expect(save).not.toHaveBeenCalled()
  fireEvent.click(within(dialog).getByRole('button', { name: 'Automatic color' }))
  fireEvent.click(within(dialog).getByRole('button', { name: 'Save' }))
  await waitFor(() => expect(save).toHaveBeenCalledTimes(1))
  expect(save.mock.calls[0][0].people.find((p) => p.id === 'Bob')!.color).toBe('#e0ad88')
  expect(save.mock.calls[0][0].associations[0].color).toEqual({ mode: 'automatic' })
})
it('dismisses on outside pointerdown and allows another editor to open', () => {
  setup()
  fireEvent.click(screen.getByRole('button', { name: 'Edit Alice' }))
  fireEvent.pointerDown(document.body)
  expect(screen.queryByRole('dialog')).toBeNull()
  fireEvent.click(screen.getByRole('button', { name: 'Edit Alice' }))
  const next = screen.getByRole('button', { name: 'Edit Bob' })
  fireEvent.pointerDown(next)
  fireEvent.click(next)
  expect(screen.getAllByRole('dialog')).toHaveLength(1)
  expect(
    (within(screen.getByRole('dialog')).getByRole('textbox', { name: 'Name' }) as HTMLInputElement)
      .value,
  ).toBe('Bob')
})
it('isolates portal input and management keys from document editing shortcuts', () => {
  setup()
  const listener = vi.fn()
  document.addEventListener('keydown', listener)
  try {
    fireEvent.click(screen.getByRole('button', { name: 'Edit Alice' }))
    const input = within(screen.getByRole('dialog')).getByRole('textbox', { name: 'Name' })
    for (const key of ['m', 'Delete', 's', ' ']) fireEvent.keyDown(input, { key })
    expect(listener).not.toHaveBeenCalled()
    fireEvent.pointerDown(document.body)
    fireEvent.click(screen.getByRole('button', { name: 'Manage people' }))
    const manager = screen.getByRole('complementary')
    for (const key of ['m', 'Delete', 'Escape']) fireEvent.keyDown(manager, { key })
    expect(listener).not.toHaveBeenCalled()
  } finally {
    document.removeEventListener('keydown', listener)
  }
})
it('does not discard a pending save or close a subsequently opened editor', async () => {
  let finish!: () => void
  const save = vi.fn(
    () =>
      new Promise<void>((resolve) => {
        finish = resolve
      }),
  )
  render(
    <SpeakerIdentityControls
      catalog={catalog}
      analyses={analyses}
      tracks={presentTracks}
      hiddenSpeakerKeys={[]}
      onTogglePeople={vi.fn()}
      onSave={save}
    />,
  )
  fireEvent.click(screen.getByRole('button', { name: 'Edit Alice' }))
  fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Save' }))
  fireEvent.pointerDown(document.body)
  expect(screen.getByRole('dialog')).toBeTruthy()
  fireEvent.click(screen.getByRole('button', { name: 'Edit Bob' }))
  await act(async () => finish())
  expect(
    (within(screen.getByRole('dialog')).getByRole('textbox', { name: 'Name' }) as HTMLInputElement)
      .value,
  ).toBe('Bob')
})
it('preserves unchanged long legacy names when another person is renamed', async () => {
  const value = {
    ...catalog,
    people: catalog.people.map((p) =>
      p.id === 'Bob' ? { ...p, displayName: 'B'.repeat(100) } : p,
    ),
  }
  const save = setup(value)
  fireEvent.click(screen.getByRole('button', { name: 'Edit Alice' }))
  const dialog = screen.getByRole('dialog')
  fireEvent.change(within(dialog).getByRole('textbox', { name: 'Name' }), {
    target: { value: 'Alicia' },
  })
  fireEvent.click(within(dialog).getByRole('button', { name: 'Save' }))
  await waitFor(() => expect(save).toHaveBeenCalledTimes(1))
  expect(save.mock.calls[0][0].people.find((p) => p.id === 'Bob')!.displayName).toBe(
    'B'.repeat(100),
  )
})
it('keeps inline rename geometry stable through blur before the save click', async () => {
  const save = setup({
    ...catalog,
    associations: [
      {
        id: 'g',
        displayName: 'Guests',
        color: { mode: 'automatic' },
        memberPersonIds: ['Alice', 'Bob'],
      },
    ],
  })
  fireEvent.click(screen.getByRole('button', { name: 'Edit Guests' }))
  const dialog = screen.getByRole('dialog')
  fireEvent.doubleClick(within(dialog).getByRole('button', { name: 'Rename Bob' }))
  const input = within(dialog).getByRole('textbox', { name: 'Rename Bob' })
  fireEvent.change(input, { target: { value: 'Robert' } })
  const button = within(dialog).getByRole('button', { name: 'Save' })
  fireEvent.pointerDown(button)
  fireEvent.blur(input, { relatedTarget: button })
  expect(within(dialog).getByRole('textbox', { name: 'Rename Bob' })).toBe(input)
  fireEvent.pointerUp(button)
  fireEvent.click(button)
  await waitFor(() => expect(save).toHaveBeenCalledTimes(1))
  expect(save.mock.calls[0][0].people.find((p) => p.id === 'Bob')!.displayName).toBe('Robert')
})

it('removes absent-source people from every surface and restores them with timeline state', () => {
  const props = {
    catalog,
    analyses,
    tracks: presentTracks,
    hiddenSpeakerKeys: [],
    onTogglePeople: vi.fn(),
    onSave: vi.fn(),
  }
  const view = render(<SpeakerIdentityControls {...props} />)
  expect(screen.getByRole('button', { name: 'Show Alice' })).toBeTruthy()
  view.rerender(<SpeakerIdentityControls {...props} tracks={presentTracks.slice(1)} />)
  expect(screen.queryByRole('button', { name: 'Show Alice' })).toBeNull()
  fireEvent.click(screen.getByRole('button', { name: 'Manage people' }))
  expect(within(screen.getByRole('tree')).queryByText('Alice')).toBeNull()
  fireEvent.click(within(screen.getByRole('tree')).getByRole('button', { name: 'Edit Bob' }))
  fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Add person' }))
  expect(within(screen.getByRole('dialog')).queryByRole('button', { name: 'Add Alice' })).toBeNull()
  fireEvent.keyDown(document, { key: 'Escape' })
  view.rerender(<SpeakerIdentityControls {...props} />)
  expect(screen.getByRole('button', { name: 'Show Alice' })).toBeTruthy()
})
it('highlights only a valid drag destination and clears feedback when leaving or cancelling', () => {
  setup()
  const alice = screen.getByRole('button', { name: 'Show Alice' }).parentElement!
  const bob = screen.getByRole('button', { name: 'Show Bob' }).parentElement!
  const dataTransfer = { setData: vi.fn(), effectAllowed: '', dropEffect: '' }
  fireEvent.dragStart(bob, { dataTransfer })
  fireEvent.dragOver(bob, { dataTransfer })
  expect(bob.classList.contains('is-drop-target')).toBe(false)
  fireEvent.dragOver(alice, { dataTransfer })
  expect(alice.classList.contains('is-drop-target')).toBe(true)
  fireEvent.dragLeave(alice, { relatedTarget: document.body })
  expect(alice.classList.contains('is-drop-target')).toBe(false)
  fireEvent.dragOver(alice, { dataTransfer })
  fireEvent.dragEnd(bob)
  expect(alice.classList.contains('is-drop-target')).toBe(false)
})

it('filters associated children and selected members when their source leaves all tracks', () => {
  const props = {
    catalog: {
      ...catalog,
      associations: [
        {
          id: 'g',
          displayName: 'Guests',
          color: { mode: 'automatic' as const },
          memberPersonIds: ['Alice', 'Bob'],
        },
      ],
    },
    analyses,
    tracks: presentTracks,
    hiddenSpeakerKeys: [],
    onTogglePeople: vi.fn(),
    onSave: vi.fn(),
  }
  const view = render(<SpeakerIdentityControls {...props} />)
  fireEvent.click(screen.getByRole('button', { name: 'Edit Guests' }))
  expect(
    within(screen.getByRole('dialog')).getByRole('button', { name: 'Rename Bob' }),
  ).toBeTruthy()
  view.rerender(
    <SpeakerIdentityControls {...props} tracks={[presentTracks[0], presentTracks[2]]} />,
  )
  expect(
    within(screen.getByRole('dialog')).queryByRole('button', { name: 'Rename Bob' }),
  ).toBeNull()
  fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Add person' }))
  expect(within(screen.getByRole('dialog')).queryByRole('button', { name: 'Add Bob' })).toBeNull()
  fireEvent.keyDown(document, { key: 'Escape' })
  fireEvent.click(screen.getByRole('button', { name: 'Manage people' }))
  fireEvent.click(screen.getByRole('button', { name: 'Expand Guests' }))
  expect(within(screen.getByRole('tree')).queryByText('Bob')).toBeNull()
  expect(within(screen.getByRole('tree')).getByText('Alice')).toBeTruthy()
  view.rerender(<SpeakerIdentityControls {...props} tracks={[presentTracks[2]]} />)
  expect(screen.queryByRole('button', { name: 'Show Guests' })).toBeNull()
  expect(within(screen.getByRole('tree')).queryByText('Guests')).toBeNull()
})
it('retains a person while another track uses the same source and closes an absent person editor', () => {
  const duplicate = { ...presentTracks[0], id: 'duplicate' }
  const props = {
    catalog,
    analyses,
    tracks: [presentTracks[0], duplicate],
    hiddenSpeakerKeys: [],
    onTogglePeople: vi.fn(),
    onSave: vi.fn(),
  }
  const view = render(<SpeakerIdentityControls {...props} />)
  fireEvent.click(screen.getByRole('button', { name: 'Edit Alice' }))
  view.rerender(<SpeakerIdentityControls {...props} tracks={[duplicate]} />)
  expect(screen.getByRole('dialog')).toBeTruthy()
  expect(screen.getByRole('button', { name: 'Show Alice' })).toBeTruthy()
  view.rerender(<SpeakerIdentityControls {...props} tracks={[]} />)
  expect(screen.queryByRole('dialog')).toBeNull()
  expect(screen.queryByRole('button', { name: 'Show Alice' })).toBeNull()
})
