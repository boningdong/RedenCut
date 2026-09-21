import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { test } from 'node:test'
import { validateMacDocumentType } from './VerifyMacDocumentType.mjs'

const require = createRequire(import.meta.url)
const config = require('../../electron-builder.config.cjs')
const declaration = () => ({
  CFBundleIdentifier: config.appId,
  ...structuredClone(config.mac.extendInfo),
})

test('release declarations describe an editable project package with an icon', () => {
  assert.equal(validateMacDocumentType(declaration()), 'icon.icns')
})
for (const [name, breakDeclaration] of [
  [
    'missing document type',
    (p) => {
      delete p.CFBundleDocumentTypes
    },
  ],
  [
    'missing exported type',
    (p) => {
      delete p.UTExportedTypeDeclarations
    },
  ],
  [
    'ordinary directory',
    (p) => {
      p.UTExportedTypeDeclarations[0].UTTypeConformsTo = ['public.directory']
    },
  ],
  [
    'wrong extension',
    (p) => {
      p.UTExportedTypeDeclarations[0].UTTypeTagSpecification['public.filename-extension'] = [
        'other',
      ]
    },
  ],
  [
    'non-package document',
    (p) => {
      p.CFBundleDocumentTypes[0].LSTypeIsPackage = false
    },
  ],
  [
    'missing icon',
    (p) => {
      delete p.CFBundleDocumentTypes[0].CFBundleTypeIconFile
    },
  ],
  [
    'wrong application',
    (p) => {
      p.CFBundleIdentifier = 'com.github.Electron'
    },
  ],
]) {
  test(`rejects ${name} before a package can be released`, () => {
    const plist = declaration()
    breakDeclaration(plist)
    assert.throws(() => validateMacDocumentType(plist), /Packaged/)
  })
}
