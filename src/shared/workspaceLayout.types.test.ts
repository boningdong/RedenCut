import { expect, test } from 'vitest'
import {
  DEFAULT_WORKSPACE_LAYOUT,
  decodeStoredWorkspaceLayout,
  WorkspaceLayoutSchema,
} from './workspaceLayout.types'

test('recovers fields and panel order independently', () => {
  const result = decodeStoredWorkspaceLayout({
    version: 1,
    contentOrder: ['audio', 'retired', 'audio'],
    transcriptRatio: 0.7,
    transportPosition: 'top',
  })
  expect(result.layout).toEqual({
    version: 1,
    contentOrder: ['audio', 'transcript'],
    transcriptRatio: 0.7,
    transportPosition: 'top',
  })
  expect(result.warning).not.toBeNull()
  expect(
    decodeStoredWorkspaceLayout({
      version: 1,
      contentOrder: ['audio'],
      transcriptRatio: 'bad',
      transportPosition: 'top',
    }).layout,
  ).toEqual({
    ...DEFAULT_WORKSPACE_LAYOUT,
    contentOrder: ['audio', 'transcript'],
    transportPosition: 'top',
  })
})
test.each([null, [], { version: 2, transcriptRatio: 0.8 }, { version: 1 }])(
  'safe fresh defaults for %j',
  (input) => {
    const result = decodeStoredWorkspaceLayout(input)
    expect(result.warning).not.toBeNull()
    expect(result.layout).toEqual(DEFAULT_WORKSPACE_LAYOUT)
    result.layout.contentOrder.reverse()
    expect(decodeStoredWorkspaceLayout(input).layout.contentOrder).toEqual(['transcript', 'audio'])
  },
)
test('accepts valid values without a warning and rejects unsafe requests', () => {
  expect(decodeStoredWorkspaceLayout(DEFAULT_WORKSPACE_LAYOUT).warning).toBeNull()
  for (const transcriptRatio of [NaN, Infinity, -Infinity, 0, 1])
    expect(
      WorkspaceLayoutSchema.safeParse({ ...DEFAULT_WORKSPACE_LAYOUT, transcriptRatio }).success,
    ).toBe(false)
  expect(
    WorkspaceLayoutSchema.safeParse({
      ...DEFAULT_WORKSPACE_LAYOUT,
      contentOrder: ['audio', 'audio'],
    }).success,
  ).toBe(false)
  expect(
    WorkspaceLayoutSchema.safeParse({ ...DEFAULT_WORKSPACE_LAYOUT, path: '/tmp/user' }).success,
  ).toBe(false)
})
