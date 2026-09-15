import { beforeEach, expect, it } from 'vitest'
import { useSpeechBatchStore } from './speechBatch.store'
import { useTranscriptStore } from './transcript.store'
beforeEach(() => useSpeechBatchStore.getState().reset())
it('retains batch progress when transcript content resets for an import', () => {
  useSpeechBatchStore.getState().begin()
  useSpeechBatchStore.getState().update({ stage: 'diarizing', percent: 25 })
  useTranscriptStore.getState().reset()
  expect(useSpeechBatchStore.getState().isGenerating).toBe(true)
  expect(useSpeechBatchStore.getState().generatingStatus?.percent).toBe(25)
})
it('retains partial results until the next batch and clears everything on workspace reset', () => {
  const summary = {
    sourceCount: 3,
    completedCount: 1,
    reusedCount: 1,
    failures: [],
    cancelled: true,
  }
  useSpeechBatchStore.getState().begin()
  useSpeechBatchStore.getState().finish(summary)
  expect(useSpeechBatchStore.getState().summary).toEqual(summary)
  expect(useSpeechBatchStore.getState().isGenerating).toBe(false)
  useSpeechBatchStore.getState().begin()
  expect(useSpeechBatchStore.getState().summary).toBeNull()
  useSpeechBatchStore.getState().reset()
  expect(useSpeechBatchStore.getState().isGenerating).toBe(false)
})
