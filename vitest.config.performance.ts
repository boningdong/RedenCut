import path from 'path'
import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['src/**/*.performance.ts'],
    disableConsoleIntercept: true,
    // Heap profiles need GC in the test worker, not only in the parent Vitest process.
    pool: 'forks',
    execArgv: ['--expose-gc'],
    fileParallelism: false,
  },
  resolve: {
    alias: {
      '@shared': path.resolve(__dirname, 'src/shared'),
      '@renderer': path.resolve(__dirname, 'src/renderer/src'),
    },
  },
})
