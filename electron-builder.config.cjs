/** @type {import('electron-builder').Configuration} */
module.exports = {
  appId: 'dev.redencut.app',
  productName: 'RedenCut',
  directories: { output: 'dist-electron/package' },
  files: ['out/**/*', 'package.json'],
  asar: true,
  npmRebuild: false,
  publish: null,
  mac: {
    target: [{ target: 'dmg', arch: ['arm64'] }],
    category: 'public.app-category.music',
    icon: 'src/main/assets/icons/macos/neon-dark-lavender.icns',
    identity: '-',
    notarize: false,
    hardenedRuntime: true,
    entitlements: 'resources/entitlements.mac.plist',
    entitlementsInherit: 'resources/entitlements.mac.plist',
    // Preserve existing ad-hoc signatures and the native runtime hash inventory.
    signIgnore: ['Contents/Resources/runtime/'],
  },
  dmg: { sign: false },
  artifactName: '${productName}-${version}-${arch}.${ext}',
}
