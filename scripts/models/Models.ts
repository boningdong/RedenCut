import { readFile, stat } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { ModelManifestSchema } from '../../src/shared/modelManifest.schema'
import { resolveModelsPath } from '../../src/main/resources/ModelsPath'
import { ModelRegistry } from '../../src/main/resources/ModelRegistry'
import { ModelInstaller } from '../../src/main/resources/ModelInstaller'
import { createModelLoadValidator } from '../../src/main/resources/validateModelLoad'
import { AppRuntimeLocator } from '../../src/main/runtime/AppRuntimeLocator'
import { resolveHuggingFaceToken } from './HuggingFaceToken.mjs'

const repository = resolve(__dirname, '../..')
const usage =
  'Usage: npm run setup:models -- [--models-path PATH] [--set default|text|smoke] [--model ID] [--import-from PATH]'

export function parseModelArguments(args: string[]) {
  const [action, ...rest] = args
  if (!['install', 'check', 'path'].includes(action)) throw new Error(usage)
  const options: {
    action: string
    modelsPath?: string
    set: string
    model?: string
    importFrom?: string
  } = { action, set: 'default' }
  const seen = new Set<string>()
  for (let index = 0; index < rest.length; index++) {
    const flag = rest[index]
    if (
      !['--models-path', '--set', '--model', '--import-from'].includes(flag) ||
      seen.has(flag) ||
      !rest[index + 1] ||
      rest[index + 1].startsWith('--')
    )
      throw new Error(usage)
    seen.add(flag)
    const value = rest[++index]
    if (flag === '--models-path') options.modelsPath = value
    if (flag === '--set') options.set = value
    if (flag === '--model') options.model = value
    if (flag === '--import-from') options.importFrom = value
  }
  if (
    !['default', 'text', 'smoke'].includes(options.set) ||
    (seen.has('--set') && options.model) ||
    (options.importFrom && action !== 'install') ||
    (action === 'path' && [...seen].some((flag) => flag !== '--models-path'))
  )
    throw new Error(usage)
  return options
}

export async function runModels(args = process.argv.slice(2)) {
  if (args.length === 2 && args[1] === '--help') {
    console.log(
      usage +
        '\nDefault: Whisper small + alignment zh/en + diarization.\n--set text excludes diarization; --set smoke installs tiny only.\ncheck:models verifies integrity offline, without downloads.\nPath: --models-path > REDENCUT_MODELS_PATH > application models directory.',
    )
    return
  }
  const options = parseModelArguments(args)
  const root = resolveModelsPath({ modelsPath: options.modelsPath })
  if (options.action === 'path') {
    console.log(root)
    return
  }
  const manifestPath = join(repository, 'speech-worker/models.json')
  const manifest = ModelManifestSchema.parse(JSON.parse(await readFile(manifestPath, 'utf8')))
  const models = manifest.models.filter((model) =>
    options.model
      ? model.id === options.model
      : options.set === 'smoke'
        ? model.capability === 'transcription-smoke'
        : model.capability === 'alignment' ||
          (model.capability === 'transcription' && model.selection?.recommended === true) ||
          (options.set === 'default' && model.capability === 'diarization'),
  )
  if (!models.length) throw new Error('Unknown model selection')
  console.error(`Model directory: ${root}`)
  const registry = new ModelRegistry(root, undefined, root)
  const installer = new ModelInstaller(registry)
  const runtime = new AppRuntimeLocator({ packaged: false, appPath: repository, resourcesPath: '' })
  const validate = createModelLoadValidator(runtime, manifestPath)
  const failures: string[] = []
  const signal = new AbortController().signal
  for (const model of models) {
    try {
      const installed = await registry.resolve(model)
      if (installed) {
        console.error(`${model.id}: ready`)
        continue
      }
      if (options.action === 'check') throw new Error('missing or invalid')
      let source: string | undefined
      if (options.importFrom) {
        const candidates = [
          join(options.importFrom, model.capability, model.id, model.revision),
          join(options.importFrom, model.id, model.revision),
          join(options.importFrom, model.capability, model.revision),
          options.model ? options.importFrom : '',
        ]
        for (const candidate of candidates.filter(Boolean)) {
          try {
            if ((await stat(join(candidate, model.files[0].path))).isFile()) {
              source = candidate
              break
            }
          } catch {
            /* Try the next explicitly supplied legacy layout. */
          }
        }
        if (!source) throw new Error('model not found in import source')
      }
      const token =
        model.access === 'gated-auto' && !source ? await resolveHuggingFaceToken() : undefined
      if (model.access === 'gated-auto' && !source && !token)
        throw new Error(
          `HF access required: accept conditions at https://huggingface.co/${model.repository}, then run hf auth login or set HF_TOKEN_PATH`,
        )
      await validate.preflight([model], signal)
      await installer.install(model, {
        signal,
        token,
        source,
        validateLoad: async (selected, path, loadSignal) => {
          console.error(`${selected.id}: validating offline load`)
          await validate(selected, path, loadSignal)
        },
      })
      console.error(`${model.id}: installed`)
    } catch (error) {
      // Tokens never enter diagnostics; downloader errors use stable public reasons.
      const reason = error instanceof Error ? error.message : 'installation failed'
      failures.push(`${model.id}: ${reason}`)
      console.error(failures[failures.length - 1])
    }
  }
  if (failures.length) {
    console.error(
      'Prepare required models with npm run setup:models -- --models-path "' + root + '"',
    )
    process.exitCode = 1
  }
}

if (require.main === module)
  runModels().catch((error) => {
    console.error(error.message)
    process.exitCode = 1
  })
