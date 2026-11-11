// Default unit and component tests across the application and harness helpers.
// Node is the default environment; individual test files can select a DOM environment.
// Integration, product E2E, and performance suites use separate configurations.
// Aliases mirror the application TypeScript configurations.

import { defineConfig } from 'vitest/config'
import path from 'path'

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['src/**/*.{test,spec}.{ts,tsx}', 'harness/tests/**/*.test.ts'],
  },
  resolve: {
    alias: {
      '@shared': path.resolve(__dirname, 'src/shared'),
      '@renderer': path.resolve(__dirname, 'src/renderer/src'),
    },
  },
})
