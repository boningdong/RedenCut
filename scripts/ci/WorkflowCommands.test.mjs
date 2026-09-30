import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { chmod, mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import test from 'node:test'
import { parse } from 'yaml'

const repository = resolve(import.meta.dirname, '../..')

// Workflow npm entrypoints intentionally use standalone literal commands. This
// guard rejects unsupported shell composition instead of claiming to parse Bash.
function npmScripts(shell) {
  const scripts = []
  for (const line of shell.split('\n')) {
    // Permit inert echo output, but reject quoted shell execution and command
    // substitutions instead of deleting quoted content that may execute npm.
    if (/^\s*(?:#|$)/.test(line)) continue
    if (/^\s*echo\s+(?:'[^']*'|"[^"$`\\]*")\s*$/.test(line)) continue
    if (!/\bnpm\b/.test(line.split('#')[0])) continue
    const tokens = line.trim().match(/[^\s]+/g)
    assert.match(line.trim(), /^npm\s/, 'Workflow npm scripts must use standalone literal commands')
    if (['ci', 'install'].includes(tokens[1])) {
      assert.match(
        line.trim(),
        /^npm (?:ci|install)(?:\s+[\w./:@=-]+)*(?:\s+#.*)?$/,
        'Workflow npm scripts must use standalone literal commands',
      )
      continue
    }
    assert.match(
      line.trim(),
      /^npm (?:run|run-script) [\w:-]+(?:\s+[\w./:-]+)*(?:\s+#.*)?$/,
      'Workflow npm scripts must use standalone literal commands',
    )
    scripts.push(tokens[2])
  }
  return scripts
}

test('workflow command extraction handles multiline calls and ignores comments and printed strings', () => {
  assert.deepEqual(
    npmScripts(`
# npm run removed
echo "npm run removed"
npm run setup:runtime
npm run setup:models -- --model diarization-default
npm run-script check # verify resources
`),
    ['setup:runtime', 'setup:models', 'check'],
  )
  for (const command of [
    'npm run "$TASK"',
    'npm run check && npm run missing',
    'npm run check; true',
    'npm ci && npm run missing',
    'npm install; npm run missing',
    'echo "$(npm run missing)"',
    'bash -c "npm run missing"',
    'echo "start"; npm run missing; echo "done"',
    'npm --silent run missing',
    'env npm run missing',
    'true && npm run missing',
    'FLAG=value npm run missing',
    '"npm" run missing',
  ])
    assert.throws(() => npmScripts(command), /standalone literal/)
})

test('all active workflow npm entrypoints exist in package scripts', async () => {
  const { scripts } = JSON.parse(await readFile(join(repository, 'package.json'), 'utf8'))
  const directory = join(repository, '.github/workflows')
  for (const filename of await readdir(directory)) {
    if (!/\.ya?ml$/.test(filename)) continue
    const workflow = parse(await readFile(join(directory, filename), 'utf8'))
    for (const [jobName, job] of Object.entries(workflow.jobs)) {
      for (const step of job.steps ?? []) {
        for (const script of npmScripts(step.run ?? ''))
          assert.ok(
            Object.hasOwn(scripts, script),
            `${filename}/${jobName}/${step.name}: missing npm script ${script}`,
          )
      }
    }
  }
})

test('the standard check executes runtime, release, model and tooling suites', async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'redencut-check-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  const executable = join(root, 'npm')
  const trace = join(root, 'trace.jsonl')
  await writeFile(
    executable,
    `#!${process.execPath}
require('node:fs').appendFileSync(process.env.TRACE, process.argv[3] + '\\n');
`,
  )
  await chmod(executable, 0o755)
  const { scripts } = JSON.parse(await readFile(join(repository, 'package.json'), 'utf8'))
  execFileSync('/bin/sh', ['-eu', '-c', scripts.check], {
    cwd: root,
    env: { ...process.env, PATH: `${root}:${process.env.PATH}`, TRACE: trace },
  })
  const called = (await readFile(trace, 'utf8')).trim().split('\n')
  for (const required of ['test:runtime', 'test:release', 'test:models', 'test:tooling'])
    assert.ok(called.includes(required), `npm run check omitted ${required}`)
})

async function releaseFixture(t, failModel = false) {
  const root = await mkdtemp(join(tmpdir(), 'redencut-workflow-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  const bin = join(root, 'bin')
  await mkdir(bin)
  const executable = join(bin, 'npm')
  await writeFile(
    executable,
    `#!${process.execPath}
const fs = require('node:fs');
const path = require('node:path');
const [verb, script, ...args] = process.argv.slice(2);
if (verb !== 'run') throw new Error('Unexpected npm invocation');
const models = process.env.REDENCUT_MODELS_PATH;
fs.appendFileSync(process.env.TRACE, JSON.stringify({script, args, models, token: Boolean(process.env.HF_TOKEN)}) + '\\n');
const ready = models && path.join(models, 'model-ready');
if (script === 'setup:runtime') fs.writeFileSync('runtime-ready', 'ready');
else if (script === 'setup:models') {
  if (!fs.existsSync('runtime-ready')) throw new Error('Runtime must be prepared first');
  if (!process.env.HF_TOKEN) throw new Error('Model credential missing');
  if (process.env.FAIL_MODEL === '1') process.exit(1);
  if (!models) throw new Error('Release must explicitly configure its model directory');
  if (args.join(' ') !== '-- --model diarization-default') throw new Error('Only bundle the release model');
  fs.mkdirSync(models, {recursive:true}); fs.writeFileSync(ready, 'ready');
} else if (script === 'check:models' || script === 'release:prepare') {
  if (!ready || !fs.existsSync(ready)) throw new Error('Bundled model was not prepared');
  if (process.env.HF_TOKEN) throw new Error('Model credentials must not reach packaging');
  if (script === 'release:prepare') fs.writeFileSync('artifact-ready', 'ready');
} else if (script === 'release:draft') {
  if (!fs.existsSync('artifact-ready')) throw new Error('No prepared release');
  fs.writeFileSync('draft-ready', 'ready');
} else throw new Error('Unexpected npm script: ' + script);
`,
  )
  await chmod(executable, 0o755)
  const { jobs } = parse(await readFile(join(repository, '.github/workflows/release.yml'), 'utf8'))
  const job = jobs.release
  const environment = {
    ...process.env,
    PATH: `${bin}:${process.env.PATH}`,
    TRACE: join(root, 'trace.jsonl'),
    HF_TOKEN: '',
    REDENCUT_MODELS_PATH: '',
    FAIL_MODEL: failModel ? '1' : '0',
  }
  for (const [name, value] of Object.entries(job.env ?? {}))
    environment[name] = value.replaceAll('${{ github.workspace }}', root)
  return { root, job, environment }
}

function runReleaseSteps({ root, job, environment }) {
  for (const step of job.steps) {
    if (!npmScripts(step.run ?? '').length) continue
    const env = { ...environment }
    for (const [name, value] of Object.entries(step.env ?? {}))
      env[name] = value
        .replaceAll('${{ secrets.HF_TOKEN }}', 'fixture-token')
        .replaceAll('${{ github.token }}', 'fixture-github-token')
    execFileSync('/bin/sh', ['-eu', '-c', step.run], { cwd: root, env, stdio: 'pipe' })
  }
}

test('actual release workflow prepares tools and the bundled model in one explicit directory before packaging', async (t) => {
  const fixture = await releaseFixture(t)
  runReleaseSteps(fixture)
  const calls = (await readFile(fixture.environment.TRACE, 'utf8'))
    .trim()
    .split('\n')
    .map(JSON.parse)
  assert.deepEqual(
    calls.map(({ script }) => script),
    ['setup:runtime', 'setup:models', 'check:models', 'release:prepare', 'release:draft'],
  )
  assert.ok(calls.every(({ models }) => models === join(fixture.root, '.runtime/release-models')))
  assert.deepEqual(
    calls.map(({ token }) => token),
    [false, true, false, false, false],
  )
  assert.equal(await readFile(join(fixture.root, 'draft-ready'), 'utf8'), 'ready')
})

test('failed model preparation stops the actual workflow before packaging or upload', async (t) => {
  const fixture = await releaseFixture(t, true)
  assert.throws(() => runReleaseSteps(fixture))
  const calls = (await readFile(fixture.environment.TRACE, 'utf8'))
    .trim()
    .split('\n')
    .map(JSON.parse)
  assert.deepEqual(
    calls.map(({ script }) => script),
    ['setup:runtime', 'setup:models'],
  )
  assert.equal((await readdir(fixture.root)).includes('artifact-ready'), false)
  assert.equal((await readdir(fixture.root)).includes('draft-ready'), false)
})
