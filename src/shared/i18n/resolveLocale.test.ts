import { describe, expect, it } from 'vitest'

import { resolveLocale } from './resolveLocale'

describe('resolveLocale', () => {
  it.each([
    ['en', ['zh-CN'], 'en'],
    ['zh-CN', ['en-US'], 'zh-CN'],
  ] as const)(
    'uses the explicit %s preference without consulting system languages',
    (preference, systemLanguages, expected) => {
      expect(resolveLocale(preference, systemLanguages)).toBe(expected)
    },
  )

  it.each([
    [['zh-Hans-SG', 'en'], 'zh-CN'],
    [['en-GB', 'zh-CN'], 'en'],
    [['fr-FR', 'zh-SG'], 'zh-CN'],
  ] as const)('uses the first supported system language from %j', (systemLanguages, expected) => {
    expect(resolveLocale('system', systemLanguages)).toBe(expected)
  })

  it.each(['zh', 'zh-CN', 'zh-SG', 'zh-Hans', 'zh-Hans-CN', 'ZH-hans-sg'])(
    'maps the Simplified Chinese language tag %s to zh-CN',
    (systemLanguage) => {
      expect(resolveLocale('system', [systemLanguage])).toBe('zh-CN')
    },
  )

  it.each(['zh-Hant', 'zh-Hant-TW', 'zh-TW', 'zh-HK', 'zh-MO'])(
    'does not treat the Traditional Chinese language tag %s as Simplified Chinese',
    (systemLanguage) => {
      expect(resolveLocale('system', [systemLanguage, 'en-GB'])).toBe('en')
    },
  )

  it('falls back to English when no system language is supported', () => {
    expect(resolveLocale('system', ['fr-FR'])).toBe('en')
  })
})
