import { defineConfig } from 'vitest/config'

export default defineConfig(({ mode }) => {
  const faults = mode === 'faults'
  const all = mode === 'all'
  if (faults || all)
    console.error(
      'Harness fault tests intentionally crash or force-terminate isolated test processes.',
    )
  return {
    test: {
      environment: 'node',
      include: [
        faults ? 'harness/tests/**/*.fault.integration.ts' : 'harness/tests/**/*.integration.ts',
      ],
      exclude: faults || all ? [] : ['harness/tests/**/*.fault.integration.ts'],
      fileParallelism: false,
      testTimeout: 60_000,
      hookTimeout: 20_000,
    },
  }
})
