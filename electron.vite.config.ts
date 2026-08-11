import { defineConfig, externalizeDepsPlugin } from 'electron-vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { resolve } from 'path'

export default defineConfig({
  // ── Main process ──────────────────────────────────────────────────────────
  // Compiled to CJS (CommonJS) because Electron's main process is Node.js.
  // externalizeDepsPlugin() marks all node_modules as external so they are
  // resolved at runtime from node_modules, not bundled into the output.
  main: {
    plugins: [externalizeDepsPlugin()],
    resolve: {
      alias: {
        '@shared': resolve('src/shared'),
        '@main': resolve('src/main'),
      },
    },
  },

  // ── Preload script ────────────────────────────────────────────────────────
  // Also compiled to CJS. Uses contextBridge to expose a typed API to the
  // renderer without giving it full Node.js access.
  preload: {
    plugins: [externalizeDepsPlugin()],
  },

  // ── Renderer process ──────────────────────────────────────────────────────
  // Compiled as ESM and served by Vite (dev: HMR dev server, prod: static).
  renderer: {
    plugins: [react({}), tailwindcss({})],
    resolve: {
      alias: {
        '@shared': resolve('src/shared'),
        '@renderer': resolve('src/renderer/src'),
      },
    },
  },
})
