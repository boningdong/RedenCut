import { defineConfig } from 'vitest/config'
import application from './vitest.config'

// Requires the managed audio runtime; the Docker base image supplies it.
export default defineConfig({
  ...application,
  test: { ...application.test, include: ['src/**/*.integration.test.{ts,tsx}'] },
})
