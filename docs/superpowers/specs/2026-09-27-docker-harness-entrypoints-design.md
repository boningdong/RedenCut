# Docker Harness Entrypoints

## Purpose and scope

The user approved one understandable Docker harness command surface with `build`, `run`, and `test` actions, plus explicit model installation and checks. The public script must be small; action implementations belong in responsibility-named subdirectories. Obsolete shell entrypoints and npm aliases may be removed without compatibility wrappers.

This first phase changes the way developers build images, run containers, and select test suites. Improving the three existing model stores and removing their duplication is a second phase. This phase must describe each store accurately and must not imply that one model installation satisfies another store's requirements.

## Current behavior to replace

- The base image is built through a raw `docker build` command, while `run-speech.sh build` builds only the derived speech image. A fresh checkout has no base image; an old base tag may be inherited silently.
- `run.sh` always defaults to the base image. Building or provisioning the speech image does not select it for subsequent runs.
- The documented `run.sh npm run test:e2e` executes all E2Es on the base image, although four current tests require a speech runtime and an application model fixture.
- `run-speech.sh provision` downloads and installs manifest-listed models into the named `/models` Docker volume, including the gated diarization model. `preflight` checks installed models without downloading. These actions are distinct from image construction.
- The speech worker and its model manifest are copied into the speech image. Test fault injection currently changes a different `/workspace` copy, and changes to worker source can go unnoticed if the image is not rebuilt.

## Public command contract

`harness/container/docker-harness.sh` is the only documented user-facing Docker harness script. It has these commands:

```sh
sh harness/container/docker-harness.sh build base
sh harness/container/docker-harness.sh build speech
sh harness/container/docker-harness.sh run base -- COMMAND [ARG...]
sh harness/container/docker-harness.sh run speech [--models ABSOLUTE_DIRECTORY] -- COMMAND [ARG...]
sh harness/container/docker-harness.sh test harness
sh harness/container/docker-harness.sh test e2e-base
sh harness/container/docker-harness.sh test e2e-speech --models ABSOLUTE_DIRECTORY
sh harness/container/docker-harness.sh test e2e-all --models ABSOLUTE_DIRECTORY
sh harness/container/docker-harness.sh models install
sh harness/container/docker-harness.sh models check
sh harness/container/docker-harness.sh mcp [base|speech] [--models ABSOLUTE_DIRECTORY]
```

`build speech` always builds the base image first, then passes that exact base tag into the speech Dockerfile build argument. `build` does not download model weights. `run` executes the supplied command in the selected image; the `--` separator makes the boundary between harness options and the container command visible. `test` selects a named repository suite and its required image, and rejects a missing speech E2E fixture before starting Electron. `mcp` starts the MCP server in the selected image and is the documented MCP client command. `models install` may download manifest-listed weights, using a read-only token mount, and `models check` performs an offline preflight.

The script prints action-specific usage on missing or invalid arguments and reports the selected image, source checkout, and model mount without exposing tokens. It never silently chooses the base image for a speech test. A missing, stale, or incompatible image fails with an actionable `build base` or `build speech` instruction. An ordinary application source edit is taken from the current checkout snapshot; image-baked speech dependencies and worker inputs must not silently drift from that checkout.

## Internal boundaries

The public dispatcher parses only the first action and delegates to private scripts, with each action in its own directory:

```text
harness/container/docker-harness.sh
harness/container/build/BuildImages.sh
harness/container/run/RunContainer.sh
harness/container/test/RunSuites.sh
harness/container/models/ManageModels.sh
harness/container/mcp/ServeMcp.sh
harness/container/config/HarnessEnvironment.sh
```

The configuration module owns repository resolution, Docker binary selection, image tags, and model-volume names. Build owns Dockerfile selection and build order. Run owns container mounts, source snapshot setup, environment, and cleanup. Test only maps suite names to the existing test runner inside the selected image. Models owns token handling, installation, and preflight. MCP invokes the run module with the server command. Private scripts are not documented as user entrypoints.

The existing two Dockerfiles remain distinct. `run.sh` and `run-speech.sh` are removed after all in-repository callers, tests, docs, and MCP instructions use the new entry. The npm aliases `speech:docker:build`, `speech:docker:provision`, and `speech:docker:preflight` are removed. Native `speech:native:*` and runtime setup commands are outside this Docker entrypoint migration.

## Test-suite boundaries

The base E2E suite includes tests that can run without Python speech models. Speech-dependent tests use an explicit file classification; the mixed diagnostics file is split so its missing-runtime case remains in the base suite and its real-model cases run in the speech suite. The internal npm test scripts are named `test:e2e:base`, `test:e2e:speech`, and `test:e2e:all`. The unqualified `test:e2e` script is removed after its callers are migrated. `test harness` runs the existing normal and fault harness suites; their lower-level npm scripts remain available for focused development.

Speech E2E fault injection must target the Python worker that Electron actually executes. The speech test run must also detect stale image-baked worker dependencies or model manifest data before reporting success. The implementation may use the current container source snapshot for worker code while retaining locked dependencies in the image; the active worker path is asserted in a targeted test.

## Model-store boundary for phase one

`models install` uses the named Docker `/models` volume. The `--models` option supplies an existing application model directory to speech E2Es as a read-only `/test-models` mount. The project-local `.runtime/models` directory supplies independently managed diarization resources through `/managed-models` when present. Help and docs explain that these locations are not interchangeable. This phase does not copy, merge, or delete model stores, and tests do not download weights implicitly.

## Verification and migration

- Shell argument tests cover every public verb, missing arguments, image selection, build order, selected base tag, token path handling, model fixture mount, and invalid combinations without contacting Docker.
- Real Docker verification builds base and speech images; runs `test harness`, `test e2e-base`, and, when the required existing model fixture is available, `test e2e-speech` and `test e2e-all`.
- The speech fault-injection tests assert that the injected code is the active worker. If the existing model fixture is unavailable, record the speech E2E result as blocked rather than passing it by simulation.
- `npm run format`, `npm run check`, runtime/release tests affected by script changes, and the host-to-container MCP smoke test are run. Documentation and error messages use only the new commands.
- The work ends with no surviving references to removed entrypoints or aliases in active source and documentation. Historical design records remain historical.

## Deferred follow-up

After this entrypoint migration, examine whether `/models`, `/test-models`, and `.runtime/models` can share one verified model source or whether each remains necessary. That later design must preserve the existing test guarantee that model setup and downloads never happen implicitly during E2E execution.
