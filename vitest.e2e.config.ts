import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    environment: 'node',
    include: ['e2e/**/*.e2e.ts'],
    fileParallelism: false,
    testTimeout: 120_000,
    hookTimeout: 20_000,
  },
})
