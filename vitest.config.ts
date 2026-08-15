// ─────────────────────────────────────────────────────────────────────────────
// Vitest configuration
//
// Targets: pure logic in the renderer and shared layers (Tier 1 tests).
// No Electron / Node.js / DOM APIs are required by these modules, so we run
// in the lightweight 'node' environment.
//
// Path aliases mirror tsconfig.web.json so that imports like
//   import { ... } from '@shared/project.types'
// resolve correctly during test runs.
// ─────────────────────────────────────────────────────────────────────────────

import { defineConfig } from 'vitest/config'
import path from 'path'

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['src/**/*.{test,spec}.{ts,tsx}'],
  },
  resolve: {
    alias: {
      '@shared': path.resolve(__dirname, 'src/shared'),
      '@renderer': path.resolve(__dirname, 'src/renderer/src'),
    },
  },
})
