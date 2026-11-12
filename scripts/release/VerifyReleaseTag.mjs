import { readReleaseState, assertReleaseTag } from './ReleaseState.mjs'

if (process.platform !== 'darwin' || process.arch !== 'arm64')
  throw new Error('macOS arm64 runner required')
const state = await readReleaseState(process.cwd())
assertReleaseTag(state, process.env.RELEASE_TAG, process.env.RELEASE_COMMIT)
console.log(`Packaging ${state.tag} from ${state.commit}`)
