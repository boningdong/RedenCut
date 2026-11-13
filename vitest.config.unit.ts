import { defineConfig, mergeConfig } from 'vitest/config'
import application from './vitest.config'

export default mergeConfig(
  application,
  defineConfig({ test: { exclude: ['src/**/*.integration.test.{ts,tsx}'] } }),
)
