import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, mkdir, writeFile, readFile, copyFile, rm, chmod } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { execFileSync, spawnSync } from 'node:child_process'
import { readReleaseState, artifactDigest } from './ReleaseState.mjs'

async function fixture(t, scenario) {
  const temp = await mkdtemp(join(tmpdir(), 'redencut-draft-test-'))
  t.after(() => rm(temp, { recursive: true, force: true }))
  const root = join(temp, 'repo')
  await mkdir(join(root, 'scripts/release'), { recursive: true })
  for (const file of ['DraftRelease.mjs', 'ReleaseState.mjs'])
    await copyFile(new URL(file, import.meta.url), join(root, 'scripts/release', file))
  await writeFile(join(root, '.gitignore'), 'dist-electron/\n')
  await writeFile(join(root, 'package.json'), JSON.stringify({ version: '0.1.0-beta' }))
  await writeFile(
    join(root, 'package-lock.json'),
    JSON.stringify({ version: '0.1.0-beta', packages: { '': { version: '0.1.0-beta' } } }),
  )
  const git = (...args) => execFileSync('git', args, { cwd: root, encoding: 'utf8' }).trim()
  git('init', '-q')
  git('config', 'user.name', 'Release Test')
  git('config', 'user.email', 'test@example.invalid')
  git('config', 'commit.gpgsign', 'false')
  git('add', '.')
  git('commit', '-qm', 'fixture')
  git('tag', 'v0.1.0-beta')
  git('remote', 'add', 'origin', 'git@github.com:example/redencut.git')
  const state = await readReleaseState(root)
  const directory = join(root, 'dist-electron/releases', state.tag)
  await mkdir(directory, { recursive: true })
  const artifact = join(directory, state.filename)
  await writeFile(artifact, 'test DMG bytes')
  const digest = await artifactDigest(artifact)
  await writeFile(join(directory, 'release.json'), JSON.stringify({ ...state, ...digest }))
  await writeFile(join(directory, 'SHA256SUMS.txt'), `${digest.sha256}  ${state.filename}\n`)
  await writeFile(join(directory, 'release-notes.md'), 'Test release notes')
  const log = join(temp, 'gh-calls.jsonl')
  const gh = join(temp, 'gh')
  await writeFile(
    gh,
    `#!${process.execPath}\n` +
      `
const {appendFileSync}=require('node:fs');
const args=process.argv.slice(2);
appendFileSync(process.env.TEST_GH_LOG, JSON.stringify(args)+'\\n');
if(args[0]==='api') {
 const endpoint=args[1];
 if(endpoint.includes('/git/ref/')) console.log(JSON.stringify({object:{type:'tag',sha:'annotation'}}));
 else if(endpoint.includes('/git/tags/')) console.log(JSON.stringify({object:{type:'commit',sha:process.env.TEST_GH_SCENARIO==='wrong-tag'?'0'.repeat(40):process.env.TEST_GH_COMMIT}}));
 else console.log(JSON.stringify([process.env.TEST_GH_SCENARIO==='new'?[]:[{tag_name:'v0.1.0-beta',draft:process.env.TEST_GH_SCENARIO!=='published',html_url:'https://github.com/example/redencut/releases/tag/v0.1.0-beta'}]]));
}
`,
  )
  await chmod(gh, 0o755)
  const run = (args = []) =>
    spawnSync(process.execPath, [join(root, 'scripts/release/DraftRelease.mjs'), ...args], {
      cwd: root,
      encoding: 'utf8',
      env: {
        ...process.env,
        PATH: `${temp}:${process.env.PATH}`,
        TEST_GH_LOG: log,
        TEST_GH_COMMIT: state.commit,
        TEST_GH_SCENARIO: scenario,
      },
    })
  const calls = async () => {
    try {
      return (await readFile(log, 'utf8')).trim().split('\n').map(JSON.parse)
    } catch (error) {
      if (error.code === 'ENOENT') return []
      throw error
    }
  }
  return { run, calls }
}

test('new beta releases are drafts, prereleases and never Latest', async (t) => {
  const { run, calls } = await fixture(t, 'new')
  const result = run()
  assert.equal(result.status, 0, result.stderr)
  const create = (await calls()).find((args) => args[0] === 'release' && args[1] === 'create')
  assert.ok(create.includes('--draft'))
  assert.ok(create.includes('--prerelease'))
  assert.ok(create.includes('--latest=false'))
  assert.ok(create.includes('--verify-tag'))
  assert.ok(create.includes('example/redencut'))
})

test('reruns replace draft assets without replacing edited notes', async (t) => {
  const { run, calls } = await fixture(t, 'draft')
  const result = run()
  assert.equal(result.status, 0, result.stderr)
  const writes = (await calls()).filter((args) => args[0] === 'release')
  assert.equal(writes.length, 1)
  assert.equal(writes[0][1], 'upload')
  assert.ok(writes[0].includes('--clobber'))
})

for (const scenario of ['published', 'wrong-tag']) {
  test(`refuses writes when ${scenario}`, async (t) => {
    const { run, calls } = await fixture(t, scenario)
    const result = run()
    assert.notEqual(result.status, 0)
    assert.equal((await calls()).filter((args) => args[0] === 'release').length, 0)
  })
}

test('dry-run validates locally without invoking GitHub', async (t) => {
  const { run, calls } = await fixture(t, 'new')
  const result = run(['--dry-run'])
  assert.equal(result.status, 0, result.stderr)
  assert.equal(JSON.parse(result.stdout).tag, 'v0.1.0-beta')
  assert.deepEqual(await calls(), [])
})
