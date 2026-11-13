import { readReleaseState, assertReleaseTag } from './ReleaseState.mjs'

const args = process.argv.slice(2)
if (args.length > 1 || (args.length === 1 && args[0] !== '--without-tag'))
  throw new Error('Usage: node scripts/release/VerifyReleaseTag.mjs [--without-tag]')
if (process.platform !== 'darwin' || process.arch !== 'arm64')
  throw new Error('macOS arm64 runner required')
const state = await readReleaseState(process.cwd())
// A rehearsal skips only tag matching, never the source commit check.
assertReleaseTag(
  state,
  args.length ? state.tag : process.env.RELEASE_TAG,
  process.env.RELEASE_COMMIT,
)
console.log(`Packaging ${state.tag} from ${state.commit}`)
