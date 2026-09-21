import { execFileSync } from 'node:child_process'
import { access } from 'node:fs/promises'
import { basename, join } from 'node:path'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const identity = require('../../src/shared/AppIdentity.json')

export function validateMacDocumentType(plist) {
  if (plist.CFBundleIdentifier !== identity.appId)
    throw new Error('Packaged application identity does not match RedenCut.')
  const type = plist.UTExportedTypeDeclarations?.find(
    (entry) => entry.UTTypeIdentifier === identity.projectType,
  )
  const document = plist.CFBundleDocumentTypes?.find((entry) =>
    entry.LSItemContentTypes?.includes(identity.projectType),
  )
  if (
    !type?.UTTypeConformsTo?.includes('com.apple.package') ||
    !type.UTTypeTagSpecification?.['public.filename-extension']?.includes(
      identity.projectExtension.slice(1),
    ) ||
    document?.LSTypeIsPackage !== true ||
    document.CFBundleTypeRole !== 'Editor' ||
    document.LSHandlerRank !== 'Owner'
  )
    throw new Error('Packaged .redencut document-package registration is missing or invalid.')
  const icon = document.CFBundleTypeIconFile
  if (typeof icon !== 'string' || !icon.endsWith('.icns') || basename(icon) !== icon)
    throw new Error('Packaged project document icon is missing or invalid.')
  return icon
}

export async function verifyMacDocumentType(appPath) {
  const contents = join(appPath, 'Contents')
  const plist = JSON.parse(
    execFileSync('/usr/bin/plutil', ['-convert', 'json', '-o', '-', join(contents, 'Info.plist')], {
      encoding: 'utf8',
    }),
  )
  const icon = validateMacDocumentType(plist)
  await access(join(contents, 'Resources', icon))
  console.log('Packaged .redencut document type and icon verified.')
}
