import { describe, expect, expectTypeOf, it } from 'vitest'

import { createTranslator } from './createTranslator'

describe('createTranslator', () => {
  it('returns an initialized instance fixed to the requested bundled locale', () => {
    const english = createTranslator('en')
    const simplifiedChinese = createTranslator('zh-CN')

    expect(english.isInitialized).toBe(true)
    expect(english.language).toBe('en')
    expect(english.t('common.cancel')).toBe('Cancel')
    expect(simplifiedChinese.isInitialized).toBe(true)
    expect(simplifiedChinese.language).toBe('zh-CN')
    expect(simplifiedChinese.t('common.cancel')).toBe('取消')
  })

  it('creates independent instances with isolated resource stores', () => {
    const first = createTranslator('en')
    const second = createTranslator('en')

    first.addResource('en', 'translation', 'common.cancel', 'Changed')

    expect(first).not.toBe(second)
    expect(first.t('common.cancel')).toBe('Changed')
    expect(second.t('common.cancel')).toBe('Cancel')
  })

  it('treats interpolated filenames containing angle brackets as ordinary text data', () => {
    const translator = createTranslator('en')

    expect(translator.t('errors.openFile', { filename: '<draft>.redencut' })).toBe(
      'Could not open <draft>.redencut.',
    )
  })

  it('uses i18next plural selection for bundled count messages', () => {
    const english = createTranslator('en')
    const simplifiedChinese = createTranslator('zh-CN')

    expect(english.t('common.trackCount', { count: 1 })).toBe('1 track')
    expect(english.t('common.trackCount', { count: 2 })).toBe('2 tracks')
    expect(simplifiedChinese.t('common.trackCount', { count: 2 })).toBe('2 个轨道')
  })

  it('formats large numeric counts by locale while keeping numeric plural selection', () => {
    const english = createTranslator('en')
    const chinese = createTranslator('zh-CN')
    expect(english.t('common.trackCount', { count: 12345 })).toBe('12,345 tracks')
    expect(chinese.t('common.trackCount', { count: 12345 })).toBe('12,345 个轨道')
    expect(english.t('common.trackCount', { count: 1 })).toBe('1 track')
  })

  it('interpolates named Generate actions as complete translated messages', () => {
    expect(createTranslator('en').t('transcript.generateTrack', { name: '<My guest>' })).toBe(
      'Generate <My guest>',
    )
    expect(createTranslator('zh-CN').t('transcript.generateTrack', { name: '<My guest>' })).toBe(
      '生成 <My guest> 的转写',
    )
  })

  it('falls back to English when an isolated Chinese test bundle is incomplete', () => {
    const translator = createTranslator('zh-CN')
    translator.removeResourceBundle('zh-CN', 'translation')
    translator.addResourceBundle('zh-CN', 'translation', { common: { cancel: '取消' } })

    expect(translator.t('common.cancel')).toBe('取消')
    expect(translator.t('export.title')).toBe('Export')
  })

  it('rejects unknown translation keys at compile time', () => {
    const translator = createTranslator('en')
    const compileOnlyUnknownKeyCall = (): void => {
      // @ts-expect-error Translation keys come from the complete English resource shape.
      translator.t('missing.key')
    }

    expectTypeOf(compileOnlyUnknownKeyCall).toBeFunction()
    expect(translator.t('app.languageLabel')).toBe('Language')
  })
})

it('interpolates clip selection counts in both bundled locales', () => {
  expect(createTranslator('en').t('waveform.clipsSelected', { count: 2 })).toBe('2 clips selected')
  expect(createTranslator('zh-CN').t('waveform.clipsSelected', { count: 3 })).toBe(
    '已选中 3 个片段',
  )
})
