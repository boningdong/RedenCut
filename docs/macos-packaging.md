# macOS packaging

## Local test builds

Run `npm run package:mac` on an Apple Silicon Mac after `npm ci` and `npm run runtime:setup` have completed.
The managed runtime and diarization model must already be available under `.runtime/`; packaging does not acquire model credentials or download model weights.
Use `npm run package:mac -- --dir` to build the application bundle without a DMG.

The output is `dist-electron/package/RedenCut-<version>-arm64.dmg`, with the application under `dist-electron/package/mac-arm64/RedenCut.app`.
The version comes from `package.json`; the app ID is `dev.redencut.app`.
This first packaging target is macOS arm64 only; Intel, Windows, and automatic updating are not included.

The script builds the Electron application, stages and checks the existing managed runtime and model, packages the application, and checks the runtime again at its final installed-bundle path.
Temporary resource staging directories are removed on completion or failure; downloader caches remain under `.runtime/`.
Packaging writes the standard build/output directories and must not run concurrently with another build of this checkout.

## Contents and signing

Compiled application code and production JavaScript dependencies are inside `app.asar`.
Native runtime files, Python packages, worker source, the model manifest, bundled diarization weights, and third-party notices are outside the archive in `Contents/Resources`.
Whisper and alignment models remain user-managed downloads through onboarding and Settings; they are not copied from the developer's personal application data.
The runtime's source archives, build evidence and license inventory travel with the runtime.

The app uses ad-hoc signing and is not Apple-notarized.
No Apple developer account, certificate, publishing token or updater is required.
The Electron bundle is signed with JIT and library-validation exceptions required by this local ad-hoc build.
The native runtime retains its existing ad-hoc signatures so its verified hash inventory stays valid.
When adding Developer ID signing later, explicitly reconcile runtime signing with the manifest rather than weakening runtime integrity validation.

A browser-downloaded build may be blocked by Gatekeeper, including a developer-verification or damaged-app message.
See [Apple's installation guidance](https://support.apple.com/102445).
A locally built app opening successfully does not establish the first-download experience on another Mac.

## Validation

Run `npm run check` and `npm run test:runtime` for source and runtime regressions.
After packaging, verify the bundle with `codesign --verify --deep --strict --verbose=2 dist-electron/package/mac-arm64/RedenCut.app` and the disk image with `hdiutil verify dist-electron/package/RedenCut-<version>-arm64.dmg`.
The packaging script additionally validates the runtime file inventory, executable loading, Python imports and short audio decoding probes from the packaged location.

A real installation trial still needs a separate Mac or clean user environment: browser download, copy to Applications, first launch, resource preparation, import/playback, transcription, save/reopen, export, and replacing the app while retaining user data.
Docker UI acceptance does not certify a macOS bundle, Gatekeeper or native macOS dialogs.
A local test package is not evidence that all public-release compatibility and third-party distribution checks are complete.

## GitHub publication

For tag-triggered builds and Release drafts, follow [GitHub Releases](github-releases.md).
The Actions workflow reuses this packaging command after preparing the runtime on its ARM64 runner.

## Project document packages

The shared `src/shared/AppIdentity.json` supplies application identity and the `.redencut` extension to both runtime constants and the packager.
The macOS bundle exports `dev.redencut.project`, conforming to `com.apple.package` and `public.content`, and declares RedenCut as its editor and owner.
Project documents currently reuse the application icon.
The project remains a directory on disk; its contents and project schema are unchanged.
The packager verifies the generated `Info.plist` declaration and referenced document icon before accepting its output.

Install the built application in Applications so Launch Services can discover the declarations.
Finder presents existing and newly saved `.redencut` directories as documents; their internal files remain accessible through Show Package Contents.
The macOS Open dialog selects project documents, while other platforms retain directory selection.
Finder opens are routed through the existing startup queue and project transition flow, including unsaved-change handling.

For development, install a build with these declarations once, then continue using `npm run dev` and its Open command.
Finder double-click opens the installed application, not the development server; rebuild/reinstall when validating installed-app code changes.
Do not modify the dependency's generic Electron.app or force the user's default application association.

Native acceptance must cover existing and new projects, Open-dialog double-click and cancellation, Finder cold/warm opens, and unsaved-change save/discard/cancel.
Also verify Show Package Contents and save/reopen with a project name containing spaces or non-ASCII characters.
Docker's prepared dialogs and unit tests do not prove these native macOS behaviors.
