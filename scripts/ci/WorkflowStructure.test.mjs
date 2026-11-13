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
    [
      'pr.yml',
      'release.yml',
      'release-test.yml',
      '_package-macos.yml',
      ...Object.values(shared),
    ].sort(),
  )
  for (const file of Object.values(files)) {
    assert.deepEqual(file.permissions, { contents: 'read' })
    for (const job of Object.values(file.jobs)) {
      assert.equal(job['continue-on-error'], undefined)
      if (job.permissions)
        assert.equal(
          job,
          files['release.yml'].jobs.publish,
          'Only publication may elevate permissions',
        )
      for (const step of job.steps ?? []) {
        assert.equal(step['continue-on-error'], undefined)
        if (step.uses) assert.match(step.uses, /@[a-f0-9]{40}$/, 'Actions must be pinned')
      }
    }
  }
  for (const entry of ['pr.yml', 'release.yml', 'release-test.yml']) {
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
  assert.equal(files['release.yml'].name, 'Release')
  assert.equal(files['release-test.yml'].name, 'Release (Test)')
  assert.deepEqual(Object.keys(files['release-test.yml'].on), ['workflow_dispatch'])
  assert.deepEqual(
    Object.keys(files['release-test.yml'].jobs).sort(),
    [...Object.keys(shared), 'package'].sort(),
  )
  for (const [entry, requireTag] of [
    ['release.yml', true],
    ['release-test.yml', false],
  ]) {
    const job = files[entry].jobs.package
    assert.deepEqual([...job.needs].sort(), Object.keys(shared).sort())
    assert.equal(job.if, undefined, 'Packaging must not bypass failed dependencies')
    assert.equal(job.uses, './.github/workflows/_package-macos.yml')
    assert.deepEqual(job.with, {
      'build-artifact-id': '${{ needs.build.outputs.artifact-id }}',
      'require-tag': requireTag,
    })
    assert.deepEqual(job.secrets, { HF_TOKEN: '${{ secrets.HF_TOKEN }}' })
  }
  const packaging = files['_package-macos.yml']
  assert.deepEqual(Object.keys(packaging.on), ['workflow_call'])
  assert.deepEqual(packaging.on.workflow_call.inputs, {
    'build-artifact-id': {
      description: 'Exact compiled application artifact from the shared Build job',
      required: true,
      type: 'string',
    },
    'require-tag': {
      description: 'Require the triggering tag to match the package version',
      required: true,
      type: 'boolean',
    },
  })
  assert.deepEqual(packaging.on.workflow_call.secrets, { HF_TOKEN: { required: true } })
  assert.equal(
    packaging.on.workflow_call.outputs['artifact-id'].value,
    '${{ jobs.package.outputs.artifact-id }}',
  )
  const release = packaging.jobs.package
  assert.equal(release.outputs['artifact-id'], '${{ steps.upload.outputs.artifact-id }}')
  assert.equal(release.permissions, undefined)
  assert.doesNotMatch(JSON.stringify(packaging), /release:draft|contents":"write|GH_TOKEN/)
  const tagCheck = release.steps.find(
    (step) => step.run === 'node scripts/release/VerifyReleaseTag.mjs',
  )
  assert.equal(tagCheck.if, 'inputs.require-tag')
  assert.equal(tagCheck.env.RELEASE_TAG, '${{ github.ref_name }}')
  assert.equal(tagCheck.env.RELEASE_COMMIT, '${{ github.sha }}')
  const sourceCheck = release.steps.find(
    (step) => step.run === 'node scripts/release/VerifyReleaseTag.mjs --without-tag',
  )
  assert.equal(sourceCheck.if, '${{ !inputs.require-tag }}')
  assert.deepEqual(sourceCheck.env, { RELEASE_COMMIT: '${{ github.sha }}' })
  assert.equal(release.env.HF_TOKEN, undefined)
  assert.deepEqual(
    release.steps.filter((step) => step.env?.HF_TOKEN).map((step) => step.run),
    [
      'node scripts/ci/CiEnvironment.mjs require-model-token',
      'npm run setup:models -- --model diarization-default',
    ],
  )
  const download = release.steps.find((step) => step.uses?.startsWith('actions/download-artifact@'))
  assert.equal(
    download?.with['artifact-ids'],
    '${{ inputs.build-artifact-id }}',
    'Download this execution’s exact Build artifact',
  )
  assert.equal(download.with.path, '.')
  assert.ok(
    release.steps.some(
      (step) =>
        step.run === 'npm run release:prepare -- --build-record dist-electron/build-record.json',
    ),
  )
  const releaseUpload = release.steps.find((step) => step.id === 'upload')
  assert.match(releaseUpload.uses, /^actions\/upload-artifact@/)
  assert.equal(releaseUpload.with.path, 'dist-electron/releases/')
  assert.equal(releaseUpload.with['if-no-files-found'], 'error')
  assert.equal(releaseUpload.if, undefined, 'Only successfully verified files may be uploaded')
  assert.equal(releaseUpload.with['retention-days'], 7)
  assert.ok(
    release.steps.indexOf(releaseUpload) >
      release.steps.findIndex((step) => step.run?.startsWith('npm run release:prepare')),
  )
  const publish = files['release.yml'].jobs.publish
  assert.deepEqual(publish.needs, ['package'])
  assert.equal(publish.if, undefined)
  assert.deepEqual(publish.permissions, { contents: 'write' })
  assert.doesNotMatch(
    JSON.stringify(publish),
    /HF_TOKEN|setup:runtime|setup:models|release:prepare/,
  )
  const publishedDownload = publish.steps.find((step) =>
    step.uses?.startsWith('actions/download-artifact@'),
  )
  assert.equal(publishedDownload.with['artifact-ids'], '${{ needs.package.outputs.artifact-id }}')
  assert.equal(publishedDownload.with.path, 'dist-electron/releases')
  const publicationCheck = publish.steps.find(
    (step) => step.run === 'node scripts/release/VerifyReleaseTag.mjs',
  )
  assert.deepEqual(publicationCheck.env, {
    RELEASE_TAG: '${{ github.ref_name }}',
    RELEASE_COMMIT: '${{ github.sha }}',
  })
  const draft = publish.steps.find((step) => step.run === 'npm run release:draft')
  assert.deepEqual(draft.env, { GH_TOKEN: '${{ github.token }}' })
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
      files['release.yml'].jobs.package.needs = ['build']
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
      files['_package-macos.yml'].jobs.package.steps.find((step) =>
        step.uses?.startsWith('actions/download-artifact@'),
      ).with['artifact-ids'] = 'previous-build'
    },
    (files) => {
      files['release.yml'].jobs.package.if = 'always()'
    },
    (files) => {
      files['release-test.yml'].jobs.package.with['require-tag'] = true
    },
    (files) => {
      files['release-test.yml'].jobs.publish = files['release.yml'].jobs.publish
    },
    (files) => {
      files['_package-macos.yml'].jobs.package.permissions = { contents: 'write' }
    },
    (files) => {
      files['release.yml'].jobs.publish.if = 'always()'
    },
    (files) => {
      files['_package-macos.yml'].jobs.package.steps.find((step) => step.id === 'upload').if =
        'always()'
    },
    (files) => {
      files['release.yml'].jobs.publish.steps.find((step) =>
        step.uses?.startsWith('actions/download-artifact@'),
      ).with['artifact-ids'] = 'previous-release'
    },
  ]) {
    const modified = structuredClone(original)
    mutate(modified)
    assert.throws(() => validate(modified))
  }
})
