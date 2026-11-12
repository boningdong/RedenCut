# Reusable PR and Release Checks

## Goal

Run useful application checks before merging a PR, and reuse their definitions when preparing a release.
Keep code checks, builds, and tests separately reported so failures are easy to identify.
Build the application once per workflow execution and pass its compiled files to release packaging rather than rebuilding them.

## Agreed File Structure

```text
.github/workflows/
├── pr.yml
├── release.yml
├── _code-quality.yml
├── _build.yml
├── _unit-tests.yml
├── _integration-tests.yml
└── _user-workflows.yml
```

`pr.yml` and `release.yml` define the events that start checks and the order in which their jobs run.
The underscore-prefixed files are reusable workflows started through `workflow_call`, not independently triggered workflows.
The underscore is a naming convention, not a GitHub privacy or execution setting.
Release-only packaging and draft publication remain in `release.yml`.

## Check Groups

| Group | Responsibility |
| --- | --- |
| Code quality | One job with separate formatting, lint, unused-code, and TypeScript-check steps |
| Build | Compile the production application and upload its compiled files as a GitHub Actions artifact |
| Unit tests | Separate JavaScript/TypeScript and Python jobs, without running Electron or real audio/speech tools |
| Integration tests | Exercise application code with actual tools such as FFmpeg; model-dependent speech tests are deferred |
| User workflows | Run existing Docker-based Electron tests for import, editing, playback, export, saving, and reopening; speech workflows are deferred |
| Release package checks | Preserve existing runtime preparation, bundled-model preparation, packaging, verification, and draft publication |

Document required tools, runtime files, and models beside the test commands and in relevant test documentation rather than putting these requirements into group names.
Existing tooling tests for runtime, models, maintenance, and releases must remain covered; model-tooling tests do not imply running actual speech inference.
Classify tests by what they execute, not just their current filename suffix.
The default Vitest suite currently includes tests that invoke real FFmpeg, so separating unit and integration tests requires inspecting their actual dependencies.

## PR Execution

Every PR targeting `main` runs Code quality, Build, Unit tests, Integration tests, and User workflows.
These checks must not require speech-model credentials, release permissions, or large speech-model downloads.
Measure execution times after the jobs run before deciding whether useful checks need to be reduced or reorganized.

The existing workflow also checks pushes to `main`; preserve that coverage when replacing `checks.yml` rather than silently removing it.
This preservation is a proposed implementation detail, not an additional user-requested check group.

## Release Execution

On a release tag, rerun the same shared checks against that tag's source commit.
Do not substitute results from an earlier PR execution.
Wait for all selected shared checks to pass before preparing the release runtime and bundled model, packaging, verifying, and uploading a draft release.

The Build workflow uploads compiled application files.
The packaging job downloads those files from the same release workflow execution.
GitHub's `needs` setting controls waiting and failure propagation; it does not transfer files by itself.

`scripts/PackageMac.mjs` currently rebuilds the application, and `scripts/release/PrepareRelease.mjs` currently invokes the combined developer check command.
Adapt the CI release path so it uses the completed shared checks and downloaded build without repeating the application build.
Preserve build-first local packaging and the complete developer verification command.
Keep existing version/tag/commit checks, runtime and model verification, code-signature and DMG verification, checksums, and draft-publication safeguards.

## Approaches Considered

- Jobs written independently in PR and release files: easy to read locally, but duplicates shared commands and allows the two sets of checks to drift.
- Independently triggered check workflows: avoids parent files, but makes ordering and passing the correct build files to packaging more complicated.
- Reusable check workflows called by PR and release files: selected because check definitions stay shared while dependencies and build-file transfers remain explicit.

## Out of Scope

- Branch protection and repository rulesets; the user will address these later.
- Adding automatic real speech tests, deliberate-crash tests, or new packaged-macOS application tests.
- Broad new coverage, performance, security, or visual-test projects beyond the agreed pipeline restructuring.

Track deferred tests in [GitHub issue #8](https://github.com/boningdong/RedenCut/issues/8), labeled `enhancement`.
Existing release package verification stays in place despite deferring additional packaged-app behavior tests.

## Implementation and Verification

The implementation plan must identify the exact test membership, dependency setup, runner operating systems, and build files needed by each job before changing commands.
Keep substantial executable logic in repository scripts rather than embedding it in workflow YAML.
Check workflow syntax and command references, and test that release packaging actually consumes the downloaded build without rebuilding it.
Verify test discovery so splitting the suites does not omit or accidentally duplicate tests.
Exercise the changed workflows on GitHub Actions, including build-file transfer, and report anything that could not be verified.
Follow the repository's existing developer verification requirements and update affected command documentation.

The user approved this design before implementation planning.
Approval is not evidence that any checks have run or pipelines have changed.
