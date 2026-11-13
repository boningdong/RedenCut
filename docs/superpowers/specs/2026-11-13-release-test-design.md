# Manual release rehearsal

## Approved design

Maintainers need to test the complete release build before creating a version tag.
`release.yml` is displayed as **Release** and retains its `v*` tag trigger.
`release-test.yml` is displayed as **Release (Test)** and starts only through `workflow_dispatch`, using the selected branch's commit.
Both run the existing five shared check workflows, then call `_package-macos.yml` with the exact Build artifact ID.
Packaging validates the platform, package version and source commit in both paths; only formal releases require a matching tag.
The reusable packaging workflow prepares the runtime and bundled model, creates and verifies the DMG without recompiling the application, and uploads the release directory as an Actions artifact.
It exposes that artifact's ID so the formal release can download precisely that result into the original directory layout and run `release:draft` in a separate publication job.
Only publication receives repository write permission; model credentials remain scoped to credential preflight and model acquisition.
Failed checks block packaging, and failed packaging blocks publication.

## Approaches

The approved approach extracts reusable packaging rather than copying the release job, avoiding drift between rehearsal and formal releases.
Adding a manual trigger to the formal entry was rejected because separate entry names make publication intent clearer.
No new public npm commands, Task runner, product behavior, release tags, or release drafts are part of this implementation.
Existing installation and packaged-app acceptance limitations remain unchanged.

## Verification and implementation outline

1. Extract packaging and add the two entry paths, explicit secret/input/output contracts, and artifact transfer.
2. Extend workflow structure and command tests to cover both paths, credential isolation, exact artifact IDs, failure dependencies and publication restrictions.
3. Update active CI/release documentation and run formatting, workflow linting, targeted tests and `npm run check`.
4. Commit and push to the existing review PR without triggering a formal release.

GitHub normally requires the manual workflow on the default branch before dispatch is available; hosted rehearsal may therefore remain blocked until merge.
Product UI acceptance is excluded because this change only reorganizes CI orchestration and does not change the application or packaging implementation.
