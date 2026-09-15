import { expect, it } from 'vitest'
import { createTranslator } from '@shared/i18n/createTranslator'
import { normalizePublicError, progressMessage, publicMessage } from './messages'

it('keeps business reasons stable and safely retranslates retained errors', () => {
  const error = normalizePublicError({
    reason: 'speech-aligning',
    message: '/private/models/file',
    cause: new Error('/private'),
  })
  expect(error).toEqual({ reason: 'speech-aligning' })
  expect(publicMessage(createTranslator('en').t, error)).toContain('Speech alignment failed')
  expect(publicMessage(createTranslator('zh-CN').t, error)).toContain('语音对齐失败')
  for (const value of [
    new Error('/private/file'),
    { reason: '__proto__' },
    { reason: 'errors.openFile' },
    '/private/file',
    null,
  ])
    expect(normalizePublicError(value)).toEqual({ reason: 'operation-failed' })
})

it('retains actionable installation guidance in Chinese without translating technical commands', () => {
  const t = createTranslator('zh-CN').t
  expect(publicMessage(t, { reason: 'whisper-missing' })).toContain('brew install whisper-cpp')
  expect(publicMessage(t, { reason: 'speech-worker-missing' })).toContain('npm run setup:speech')
  expect(publicMessage(t, { reason: 'whisper-model-missing' })).toContain('打开设置')
  expect(progressMessage(t, { stage: 'building-cache' })).toBe('正在建立缓存')
})

it('localizes structured speech failures and discards unknown failure details', () => {
  const retained = normalizePublicError({
    reason: 'speech-diarizing',
    failureKind: 'startup',
    message: '/private',
  })
  expect(retained).toEqual({ reason: 'speech-diarizing', failureKind: 'startup' })
  expect(publicMessage(createTranslator('en').t, retained)).toContain('could not start')
  expect(publicMessage(createTranslator('zh-CN').t, retained)).toContain('无法启动')
  expect(normalizePublicError({ reason: 'speech-aligning', failureKind: '/private' })).toEqual({
    reason: 'speech-aligning',
  })
})
