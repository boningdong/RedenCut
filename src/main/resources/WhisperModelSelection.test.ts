import { expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { ModelManifestSchema } from '../../shared/modelManifest.schema'
import { selectWhisperDefinition } from './WhisperModelSelection'
const models = ModelManifestSchema.parse(
  JSON.parse(readFileSync('speech-worker/models.json', 'utf8')),
).models
it('resolves the chosen model independently of ordering and falls back to the original Small installation', () => {
  expect(selectWhisperDefinition([...models].reverse())?.id).toBe('transcription-default')
  expect(selectWhisperDefinition(models, 'transcription-whisper-large-v3')?.files[0].path).toBe(
    'ggml-large-v3.bin',
  )
  expect(selectWhisperDefinition(models, 'alignment-zh')?.id).toBe('transcription-default')
  expect(selectWhisperDefinition(models, 'no-longer-supported')?.id).toBe('transcription-default')
})
