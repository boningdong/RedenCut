import { expect, it } from 'vitest'
import { createTranslator } from '@shared/i18n/createTranslator'
import { normalizePublicError, progressMessage, publicMessage } from './messages'

it('retranslates a retained alignment failure without changing its diagnostic ID', () => {
  const id = '550e8400-e29b-41d4-a716-446655440001'
  const message = normalizePublicError({
    reason: 'speech-alignment-input',
    diagnosticId: id,
    privatePath: '/private/audio',
  })
  expect(message).toEqual({ reason: 'speech-alignment-input', diagnosticId: id })
  expect(publicMessage(createTranslator('zh-CN').getFixedT('zh-CN'), message)).toContain(
    '初步文字识别已完成',
  )
  expect(publicMessage(createTranslator('en').getFixedT('en'), message)).toContain(
    'Preliminary speech recognition finished',
  )
})

it('keeps business reasons stable and safely retranslates retained errors', () => {
  const error = normalizePublicError({
    reason: 'speech-aligning',
    message: '/private/models/file',
    cause: new Error('/private'),
  })
  expect(error).toEqual({ reason: 'speech-aligning' })
  expect(publicMessage(createTranslator('en').t, error)).toContain(
    'Speech alignment did not finish',
  )
  expect(publicMessage(createTranslator('zh-CN').t, error)).toContain('语音对齐未完成')
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
  expect(publicMessage(t, { reason: 'whisper-missing' })).toContain('修复或重新安装应用')
  expect(publicMessage(t, { reason: 'speech-worker-missing' })).toContain('修复或重新安装应用')
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
