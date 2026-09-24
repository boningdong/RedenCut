import { describe, expect, it } from 'vitest'

import { englishResources } from './en'
import { simplifiedChineseResources } from './zh-CN'

const requiredGroups = [
  'diagnostics',
  'preparation',
  'mediaRecovery',
  'speechTasks',
  'speakerIdentity',
  'settings',
  'common',
  'app',
  'transport',
  'waveform',
  'transcript',
  'export',
  'workspace',
  'dialogs',
  'progress',
  'errors',
] as const

function leafKeys(value: object, prefix = ''): string[] {
  return Object.entries(value).flatMap(([key, child]) => {
    const path = prefix ? `${prefix}.${key}` : key
    return typeof child === 'string' ? [path] : leafKeys(child as object, path)
  })
}

describe('translation resources', () => {
  it('provides every required semantic group in both locales', () => {
    expect(Object.keys(englishResources)).toEqual(requiredGroups)
    expect(Object.keys(simplifiedChineseResources)).toEqual(requiredGroups)
  })

  it('keeps every English and Simplified Chinese leaf key in parity', () => {
    expect(leafKeys(simplifiedChineseResources).sort()).toEqual(leafKeys(englishResources).sort())
  })

  it('keeps plural forms in parity across locales', () => {
    const englishPluralKeys = leafKeys(englishResources).filter((key) => /_(one|other)$/.test(key))
    const simplifiedChinesePluralKeys = leafKeys(simplifiedChineseResources).filter((key) =>
      /_(one|other)$/.test(key),
    )
    const pluralBases = new Set(englishPluralKeys.map((key) => key.replace(/_(one|other)$/, '')))

    expect(pluralBases).toContain('common.trackCount')
    for (const base of pluralBases) {
      expect(englishPluralKeys).toEqual(expect.arrayContaining([`${base}_one`, `${base}_other`]))
    }
    expect(simplifiedChinesePluralKeys.sort()).toEqual(englishPluralKeys.sort())
  })
})
