const identity = require('./src/shared/AppIdentity.json')

/** @type {import('electron-builder').Configuration} */
module.exports = {
  appId: identity.appId,
  productName: identity.name,
  directories: { output: 'dist-electron/package' },
  files: ['out/**/*', 'package.json'],
  asar: true,
  npmRebuild: false,
  publish: null,
  mac: {
    target: [{ target: 'dmg', arch: ['arm64'] }],
    category: 'public.app-category.music',
    icon: 'src/main/assets/icons/macos/neon-dark-lavender.icns',
    extendInfo: {
      CFBundleDocumentTypes: [
        {
          CFBundleTypeName: `${identity.name} Project`,
          CFBundleTypeRole: 'Editor',
          LSHandlerRank: 'Owner',
          LSItemContentTypes: [identity.projectType],
          CFBundleTypeExtensions: [identity.projectExtension.slice(1)],
          LSTypeIsPackage: true,
          CFBundleTypeIconFile: 'icon.icns',
        },
      ],
      UTExportedTypeDeclarations: [
        {
          UTTypeIdentifier: identity.projectType,
          UTTypeDescription: `${identity.name} Project`,
          UTTypeConformsTo: ['com.apple.package', 'public.content'],
          UTTypeTagSpecification: {
            'public.filename-extension': [identity.projectExtension.slice(1)],
          },
          UTTypeIconFile: 'icon.icns',
        },
      ],
    },
    identity: '-',
    notarize: false,
    hardenedRuntime: true,
    entitlements: 'resources/entitlements.mac.plist',
    entitlementsInherit: 'resources/entitlements.mac.plist',
  },
  dmg: { sign: false },
  artifactName: '${productName}-${version}-${arch}.${ext}',
}
