import { defineConfig } from 'eslint/config'
import js from '@eslint/js'
import globals from 'globals'
import eslintPluginPrettier from 'eslint-plugin-prettier'
import eslintConfigPrettier from 'eslint-config-prettier/flat'
import { configs as wdioConfig } from 'eslint-plugin-wdio'

export default defineConfig([
  {
    ignores: ['allure-results/', 'allure-report/', 'docker/']
  },

  js.configs.recommended,

  wdioConfig['flat/recommended'],

  {
    files: ['**/*.js'],
    languageOptions: {
      ecmaVersion: 'latest',
      sourceType: 'module',
      globals: {
        ...globals.node,
        ...globals.mocha
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

  eslintConfigPrettier
])
