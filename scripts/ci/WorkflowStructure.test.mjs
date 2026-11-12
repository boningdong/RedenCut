import assert from 'node:assert/strict'
import { readFile, readdir } from 'node:fs/promises'
import { resolve, join } from 'node:path'
import test from 'node:test'
import { parse } from 'yaml'

const directory = resolve(import.meta.dirname, '../../.github/workflows')
const shared = {
  quality: '_code-quality.yml',
  build: '_build.yml',
  unit: '_unit-tests.yml',
  integration: '_integration-tests.yml',
  users: '_user-workflows.yml',
}

async function workflows() {
  const entries = await Promise.all(
    (await readdir(directory))
      .filter((name) => name.endsWith('.yml'))
      .map(async (name) => [name, parse(await readFile(join(directory, name), 'utf8'))]),
  )
  return Object.fromEntries(entries)
}

function validate(files) {
  assert.deepEqual(
    Object.keys(files).sort(),
    ['pr.yml', 'release.yml', ...Object.values(shared)].sort(),
  )
  for (const file of Object.values(files)) {
    assert.deepEqual(file.permissions, { contents: 'read' })
    for (const job of Object.values(file.jobs)) {
      for (const step of job.steps ?? []) {
        if (step.uses) assert.match(step.uses, /@[a-f0-9]{40}$/, 'Actions must be pinned')
      }
    }
  }
  for (const entry of ['pr.yml', 'release.yml']) {
    for (const [job, name] of Object.entries(shared)) {
      assert.equal(
        files[entry].jobs[job].uses,
        `./.github/workflows/${name}`,
        'Shared workflow reference',
      )
      assert.equal(
        files[entry].jobs[job].secrets,
        undefined,
        'Shared checks must not inherit credentials',
      )
    }
  }
  for (const name of Object.values(shared)) {
    assert.deepEqual(Object.keys(files[name].on), ['workflow_call'])
    assert.doesNotMatch(
      JSON.stringify(files[name]),
      /test:harness:(all|faults)|test:e2e:(speech|all)|test e2e-(speech|all)|test harness|setup:models|HF_TOKEN|secrets/,
      'Deferred suites and model credentials must stay outside shared checks',
    )
    for (const job of Object.values(files[name].jobs)) {
      assert.equal(job.permissions, undefined, 'Shared jobs inherit read-only permissions')
      assert.equal(job.continueOnError ?? job['continue-on-error'], undefined)
    }
  }
  assert.deepEqual(files['pr.yml'].on.pull_request.branches, ['main'])
  assert.deepEqual(files['pr.yml'].on.push.branches, ['main'])
  assert.equal(files['pr.yml'].concurrency['cancel-in-progress'], true)
  assert.deepEqual(files['release.yml'].on.push.tags, ['v*'])
  assert.equal(files['release.yml'].concurrency['cancel-in-progress'], false)
  const release = files['release.yml'].jobs.release
  assert.deepEqual(
    [...release.needs].sort(),
    Object.keys(shared).sort(),
    'Packaging must wait for every shared check',
  )
  assert.equal(release.if, undefined, 'Packaging must not bypass failed dependencies')
  assert.equal(release['continue-on-error'], undefined)
  assert.deepEqual(release.permissions, { contents: 'write' })
  const download = release.steps.find((step) => step.uses?.startsWith('actions/download-artifact@'))
  assert.equal(
    download?.with['artifact-ids'],
    '${{ needs.build.outputs.artifact-id }}',
    'Download this execution’s exact Build artifact',
  )
  assert.equal(download.with.path, '.')
  assert.ok(
    release.steps.some(
      (step) =>
        step.run === 'npm run release:prepare -- --build-record dist-electron/build-record.json',
    ),
  )
  const upload = files['_build.yml'].jobs.build.steps.find((step) => step.id === 'upload')
  assert.match(upload.with.path, /out\//)
  assert.match(upload.with.path, /dist-electron\/build-record.json/)
  assert.ok(
    files['_integration-tests.yml'].jobs.integration.steps.some((step) =>
      step.run?.endsWith('npm run test:harness'),
    ),
  )
  assert.ok(
    files['_user-workflows.yml'].jobs.users.steps.some(
      (step) =>
        step.run ===
        'sh harness/container/docker-harness.sh test e2e-base --models-path .runtime/ci-models',
    ),
  )
}

test('PR and release share the selected checks with safe dependencies and artifact transfer', async () =>
  validate(await workflows()))

test('workflow guard rejects broken sharing, omitted checks, deferred suites and credential inheritance', async () => {
  const original = await workflows()
  for (const mutate of [
    (files) => {
      files['pr.yml'].jobs.build.uses = './.github/workflows/missing.yml'
    },
    (files) => {
      files['release.yml'].jobs.release.needs = ['build']
    },
    (files) => {
      files['_integration-tests.yml'].jobs.integration.steps.push({
        run: 'npm run test:harness:all',
      })
    },
    (files) => {
      files['pr.yml'].jobs.unit.secrets = 'inherit'
    },
    (files) => {
      files['release.yml'].jobs.release.steps.find((step) =>
        step.uses?.startsWith('actions/download-artifact@'),
      ).with['artifact-ids'] = 'previous-build'
    },
    (files) => {
      files['release.yml'].jobs.release.if = 'always()'
    },
  ]) {
    const modified = structuredClone(original)
    mutate(modified)
    assert.throws(() => validate(modified))
  }
})
