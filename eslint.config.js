import { defineConfig } from 'eslint/config'
import js from '@eslint/js'
import globals from 'globals'
import playwright from 'eslint-plugin-playwright'
import eslintPluginPrettier from 'eslint-plugin-prettier'
import eslintConfigPrettier from 'eslint-config-prettier/flat'

export default defineConfig([
  {
    ignores: ['playwright-report/', 'test-results/', 'docker/']
  },

  js.configs.recommended,

  {
    files: ['**/*.js'],
    languageOptions: {
      ecmaVersion: 'latest',
      sourceType: 'module',
      globals: {
        ...globals.node
      }
    },
    plugins: {
      prettier: eslintPluginPrettier
    },
    rules: {
      'prettier/prettier': 'error',
      'no-console': 'error',
      'no-unused-vars': ['error', { argsIgnorePattern: '^_' }]
    }
  },

  {
    files: ['tests/**/*.js'],
    ...playwright.configs['flat/recommended'],
    rules: {
      ...playwright.configs['flat/recommended'].rules,
      // .ai/coding-rules.md: no fixed sleeps, no focused or skipped tests.
      'playwright/no-wait-for-timeout': 'error',
      'playwright/no-focused-test': 'error',
      'playwright/no-skipped-test': 'error',
      // Specs import test/expect from #fixtures/index.js, so tell the plugin.
      'playwright/expect-expect': ['error', { assertFunctionNames: ['expect'] }]
    },
    settings: {
      playwright: {
        globalAliases: { test: ['test'] }
      }
    }
  },

  eslintConfigPrettier
])
