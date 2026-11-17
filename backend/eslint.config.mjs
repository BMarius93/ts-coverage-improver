// @ts-check
import eslint from '@eslint/js';
import prettier from 'eslint-config-prettier';
import globals from 'globals';
import tseslint from 'typescript-eslint';

const INFRASTRUCTURE_LIBS = [
  '@nestjs/*',
  'better-sqlite3',
  'simple-git',
  'octokit',
  '@octokit/*',
  'zod',
  'express',
  'child_process',
  'node:child_process',
  'fs',
  'node:fs',
  'fs/promises',
  'node:fs/promises',
];

export default tseslint.config(
  { ignores: ['dist/**', 'coverage/**', 'node_modules/**', 'eslint.config.mjs', 'jest.config.js', 'test/jest-e2e.config.js'] },
  eslint.configs.recommended,
  ...tseslint.configs.recommendedTypeChecked,
  prettier,
  {
    languageOptions: {
      globals: { ...globals.node, ...globals.jest },
      parserOptions: { projectService: true, tsconfigRootDir: import.meta.dirname },
    },
    rules: {
      '@typescript-eslint/no-floating-promises': 'error',
      '@typescript-eslint/explicit-module-boundary-types': 'off',
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
    },
  },
  {
    // The domain is pure TypeScript: no framework, persistence, process or outer-layer imports.
    files: ['src/domain/**/*.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            { group: INFRASTRUCTURE_LIBS, message: 'The domain layer must not depend on frameworks or I/O libraries.' },
            {
              group: ['**/application/**', '**/infrastructure/**', '**/interface/**'],
              message: 'The domain layer must not import from outer layers.',
            },
          ],
        },
      ],
    },
  },
  {
    // Use cases are plain classes wired by factories, so they stay constructible without Nest.
    files: ['src/application/**/*.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            { group: INFRASTRUCTURE_LIBS, message: 'The application layer talks to the outside world through ports only.' },
            {
              group: ['**/infrastructure/**', '**/interface/**'],
              message: 'The application layer must not import from outer layers.',
            },
          ],
        },
      ],
    },
  },
  {
    files: ['test/**/*.ts'],
    rules: {
      '@typescript-eslint/unbound-method': 'off',
      '@typescript-eslint/require-await': 'off',
    },
  },
);
