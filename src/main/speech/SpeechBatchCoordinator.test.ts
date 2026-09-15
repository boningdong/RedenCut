import { expect, it } from 'vitest'
import type { SpeechArtifact } from '../../shared/speechArtifact.schema'
import type { AudioSourceId } from '../../shared/source.types'
import { SpeechBatchCoordinator } from './SpeechBatchCoordinator'
const artifact = (id: string, completed = false) =>
  ({
    audioSourceId: id,
    diarizationStatus: completed ? 'completed' : 'pending',
    ...(completed ? { diarization: {} } : {}),
  }) as SpeechArtifact
const sources = () =>
  ['A', 'B'].map((id) => ({ audioSourceId: id as AudioSourceId, displayName: id }))
function setup(options: { fail?: string; cancelAfterText?: boolean } = {}) {
  const calls: string[] = []
  const saved = new Map<string, SpeechArtifact>()
  const abort = new AbortController()
  const coordinator = new SpeechBatchCoordinator({
    async analyzeText(source) {
      calls.push(`text:${source.displayName}`)
      if (source.displayName === options.fail) throw new Error('recognition failed')
      return artifact(source.audioSourceId)
    },
    async analyzeSpeakers(source) {
      calls.push(`speakers:${source.displayName}`)
      return artifact(source.audioSourceId, true)
    },
    async publish(source, result) {
      calls.push(`save:${source.displayName}`)
      saved.set(source.audioSourceId, result)
      if (options.cancelAfterText) abort.abort()
    },
    publicFailure: () => ({ reason: 'operation-failed' }),
  })
  return { coordinator, calls, saved, abort }
}
it('publishes every text before any speaker recognition and finishes every source', async () => {
  const { coordinator, calls, abort, saved } = setup()
  const result = await coordinator.run(sources(), true, abort.signal)
  expect(calls).toEqual([
    'text:A',
    'save:A',
    'text:B',
    'save:B',
    'speakers:A',
    'save:A',
    'speakers:B',
    'save:B',
  ])
  expect([...saved.keys()]).toEqual(['A', 'B'])
  expect(result.completedCount).toBe(2)
  expect(result.failures).toEqual([])
})
it('retains completed text on cancellation and starts no remaining work', async () => {
  const { coordinator, calls, abort, saved } = setup({ cancelAfterText: true })
  const result = await coordinator.run(sources(), true, abort.signal)
  expect(calls).toEqual(['text:A', 'save:A'])
  expect(saved.get('A')).toMatchObject({ diarizationStatus: 'pending' })
  expect(result.cancelled).toBe(true)
})
it('continues unrelated sources after one fails', async () => {
  const { coordinator, calls, abort } = setup({ fail: 'A' })
  const result = await coordinator.run(sources(), true, abort.signal)
  expect(calls).toEqual(['text:A', 'text:B', 'save:B', 'speakers:B', 'save:B'])
  expect(result.failures).toEqual([expect.objectContaining({ audioSourceId: 'A', phase: 'text' })])
  expect(result.completedCount).toBe(1)
})
it('reuses completed analysis and runs only speakers for pending text', async () => {
  const { coordinator, calls, abort } = setup()
  const items = sources().map((item, index) => ({
    ...item,
    artifact: artifact(item.audioSourceId, index === 0),
  }))
  const result = await coordinator.run(items, true, abort.signal)
  expect(calls).toEqual(['speakers:B', 'save:B'])
  expect(result.completedCount).toBe(2)
  expect(result.reusedCount).toBe(1)
})
it('does not start engines for pre-cancelled batches', async () => {
  const { coordinator, calls, abort } = setup()
  abort.abort()
  expect((await coordinator.run(sources(), true, abort.signal)).cancelled).toBe(true)
  expect(calls).toEqual([])
})
it('does not request speakers when recognition is disabled', async () => {
  const { coordinator, calls, abort } = setup()
  expect((await coordinator.run(sources(), false, abort.signal)).completedCount).toBe(2)
  expect(calls).toEqual(['text:A', 'save:A', 'text:B', 'save:B'])
})
