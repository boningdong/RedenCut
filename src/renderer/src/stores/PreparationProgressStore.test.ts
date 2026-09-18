import { beforeEach, expect, it } from 'vitest'
import { usePreparationProgressStore as store } from './PreparationProgressStore'
import type { ProjectOpenProgressEvent } from '@shared/AudioPreparationTypes'
const event: ProjectOpenProgressEvent = {
  operationId: 'open',
  sequence: 1,
  stage: 'reading-project',
  progress: { kind: 'indeterminate' },
}
const identity = { jobId: 'import', workspaceToken: 'workspace' as never, revision: 1 }
beforeEach(() => store.setState({ active: null, opening: null, importing: null }))
it('waits for an event and rejects stale operations, sequences and ended events', () => {
  store.getState().beginOpen('open')
  expect(store.getState().active?.visible).toBe(false)
  store.getState().receiveOpen({ ...event, operationId: 'old' })
  expect(store.getState().active?.visible).toBe(false)
  store.getState().receiveOpen(event)
  store.getState().receiveOpen({ ...event, stage: 'building-cache' })
  expect(store.getState().active?.stage).toBe('reading-project')
  store.getState().end('old')
  expect(store.getState().active).not.toBeNull()
  store.getState().end('open')
  store.getState().receiveOpen({ ...event, sequence: 2 })
  expect(store.getState().active).toBeNull()
})
it('retains renderer preparation against late main events until completion', () => {
  store.getState().beginOpen('open')
  store.getState().prepareEditor('open')
  store.getState().receiveOpen({ ...event, sequence: 5 })
  expect(store.getState().active?.stage).toBe('preparing-editor')
  expect(store.getState().active?.visible).toBe(true)
})
it('guards import identity and holds cancellation until commit or settlement', () => {
  store.getState().beginImport(identity, 'voice.wav')
  store.getState().receiveImport({
    ...identity,
    revision: 2,
    displayName: 'wrong',
    stage: 'building-cache',
    percent: 0.5,
  })
  expect(store.getState().active?.stage).toBe('selected')
  store.getState().cancelling('import')
  store
    .getState()
    .receiveImport({ ...identity, displayName: 'voice.wav', stage: 'ready', percent: 1 })
  expect(store.getState().active?.stage).toBe('cancelling')
  store.getState().prepareEditor('import')
  expect(store.getState().active?.stage).toBe('preparing-editor')
  expect(store.getState().active?.canCancel).toBe(false)
})
it('restores cancellation availability after a failed cancellation request', () => {
  store.getState().beginImport(identity, 'voice.wav')
  store.getState().cancelling('import')
  store.getState().cancelFailed('import')
  expect(store.getState().active?.canCancel).toBe(true)
  expect(store.getState().active?.stage).toBe('selected')
})

it('restores import progress when an overlapping project chooser or open is cancelled', () => {
  store.getState().beginImport(identity, 'voice.wav')
  store.getState().beginOpen('open')
  expect(store.getState().active?.kind).toBe('import')
  store.getState().receiveOpen(event)
  expect(store.getState().active?.kind).toBe('open')
  store
    .getState()
    .receiveImport({ ...identity, displayName: 'voice.wav', stage: 'copying', percent: 0.6 })
  store.getState().end('open')
  expect(store.getState().active?.kind).toBe('import')
  expect(store.getState().active?.progress).toEqual({ kind: 'determinate', fraction: 0.6 })
})
it('ending an import does not clear a visible open operation', () => {
  store.getState().beginImport(identity, 'voice.wav')
  store.getState().beginOpen('open')
  store.getState().receiveOpen(event)
  store.getState().end('import')
  expect(store.getState().active?.id).toBe('open')
  store.getState().end('open')
  expect(store.getState().active).toBeNull()
})
