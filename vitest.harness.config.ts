import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    environment: 'node',
    include: ['harness/tests/**/*.integration.ts'],
    fileParallelism: false,
    testTimeout: 60_000,
    hookTimeout: 20_000,
  },
})
