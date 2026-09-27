import { defineConfig } from 'vitest/config'

const speechFiles = [
  'e2e/speech-analysis.e2e.ts',
  'e2e/transcript-overlap.e2e.ts',
  'e2e/diagnostics-speech.e2e.ts',
]

export default defineConfig(({ mode }) => ({
  test: {
    environment: 'node',
    include: mode === 'speech' ? speechFiles : ['e2e/**/*.e2e.ts'],
    exclude: mode === 'base' ? speechFiles : [],
    fileParallelism: false,
    testTimeout: 120_000,
    hookTimeout: 20_000,
  },
}))
