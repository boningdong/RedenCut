import eslint from '@eslint/js'
import prettier from 'eslint-config-prettier'
import reactHooks from 'eslint-plugin-react-hooks'
import globals from 'globals'
import { builtinModules } from 'node:module'
import tseslint from 'typescript-eslint'

const nodeImports = [
  ...new Set([...builtinModules, ...builtinModules.map((name) => `node:${name}`)]),
]
const restrictedNodeImports = nodeImports.map((name) => ({
  name,
  message: 'Renderer and shared code cannot import Node.js modules.',
}))

export default tseslint.config(
  {
    ignores: ['node_modules/**', 'out/**', 'dist/**', 'dist-electron/**', 'coverage/**'],
  },
  eslint.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ['**/*.{ts,tsx}'],
    languageOptions: {
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      'no-console': ['error', { allow: ['warn', 'error'] }],
      '@typescript-eslint/consistent-type-imports': [
        'error',
        { prefer: 'type-imports', fixStyle: 'separate-type-imports' },
      ],
      '@typescript-eslint/no-floating-promises': 'error',
      '@typescript-eslint/no-misused-promises': 'error',
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', caughtErrorsIgnorePattern: '^_' },
      ],
    },
  },
  {
    files: ['src/renderer/**/*.{ts,tsx}'],
    languageOptions: { globals: globals.browser },
    plugins: { 'react-hooks': reactHooks },
    rules: {
      'react-hooks/rules-of-hooks': 'error',
      'react-hooks/exhaustive-deps': 'error',
      'no-restricted-imports': [
        'error',
        {
          paths: [
            { name: 'electron', message: 'Renderer code must use window.electronAPI.' },
            ...restrictedNodeImports,
          ],
          patterns: [
            {
              group: ['electron/*'],
              message: 'Renderer code must use window.electronAPI.',
            },
            {
              group: ['@main/*', '@preload/*', '**/main/**', '**/preload/**'],
              message: 'Renderer code cannot import main or preload internals.',
            },
          ],
        },
      ],
    },
  },
  {
    files: ['src/main/**/*.ts'],
    languageOptions: { globals: globals.node },
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: ['@renderer/*', '**/renderer/**', '**/preload/**'],
              message: 'Main code cannot import renderer or preload internals.',
            },
          ],
        },
      ],
    },
  },
  {
    files: ['src/preload/**/*.ts'],
    languageOptions: { globals: globals.node },
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: ['@main/*', '@renderer/*', '**/main/**', '**/renderer/**'],
              message: 'Preload code must remain a narrow bridge over shared contracts.',
            },
          ],
        },
      ],
    },
  },
  {
    files: ['src/shared/**/*.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          paths: [
            { name: 'electron', message: 'Shared code must remain process-neutral.' },
            ...restrictedNodeImports,
          ],
          patterns: [
            {
              group: ['electron/*'],
              message: 'Shared code must remain process-neutral.',
            },
            {
              group: [
                '@main/*',
                '@preload/*',
                '@renderer/*',
                '**/main/**',
                '**/preload/**',
                '**/renderer/**',
              ],
              message: 'Shared code cannot import process-specific modules.',
            },
          ],
        },
      ],
    },
  },
  {
    files: ['*.config.ts'],
    languageOptions: { globals: globals.node },
    rules: { 'no-console': 'off' },
  },
  prettier,
)
