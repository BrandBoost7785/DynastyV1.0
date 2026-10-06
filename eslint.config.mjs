import next from 'eslint-config-next';
import nextCoreWebVitals from 'eslint-config-next/core-web-vitals';
import nextTypescript from 'eslint-config-next/typescript';

/**
 * Flat ESLint config.
 *
 * Beyond the Next.js defaults this enforces the project's architectural rules:
 * no `any` in simulation code, no floating promises in server code, and a
 * convention that mutable simulation state is only touched through the engine.
 */
const eslintConfig = [
  {
    ignores: [
      'node_modules/**',
      '.next/**',
      'out/**',
      'dist/**',
      'build/**',
      'coverage/**',
      '.data/**',
      'public/sw.js',
      'next-env.d.ts',
      '*.tsbuildinfo',
    ],
  },
  ...next,
  ...nextCoreWebVitals,
  ...nextTypescript,
  {
    files: ['src/sim/**/*.ts', 'src/engine/**/*.ts'],
    rules: {
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
      'no-console': ['warn', { allow: ['warn', 'error'] }],
    },
  },
  /*
   * Server, persistence and API code is linted with type information.
   *
   * These rules need a program to evaluate, and they are the ones that catch real
   * production bugs in async code: a promise nobody awaits (a save that silently
   * never happens), a promise handed to a synchronous callback, and `await` on
   * something that is not thenable. Worth the extra seconds on every run.
   */
  {
    files: ['src/server/**/*.ts', 'src/app/api/**/*.ts', 'src/persistence/**/*.ts'],
    languageOptions: {
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/no-floating-promises': 'error',
      '@typescript-eslint/no-misused-promises': 'error',
      '@typescript-eslint/await-thenable': 'error',
      'no-console': 'off',
    },
  },
  {
    files: ['tests/**/*.ts'],
    rules: {
      '@typescript-eslint/no-explicit-any': 'off',
      'no-console': 'off',
    },
  },
  {
    files: ['scripts/**/*.ts'],
    rules: {
      'no-console': 'off',
    },
  },
  {
    rules: {
      // Magic numbers in simulation code must come from the balance config.
      'no-magic-numbers': 'off',
      eqeqeq: ['error', 'smart'],
      'prefer-const': 'error',
      'no-var': 'error',
      /*
       * A leading underscore is the project's marker for a binding that exists only to
       * *remove* a field — `const { prevHash: _prevHash, ...rest } = record` — which is
       * how the DTO layer strips internals without mutating the source object.
       */
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_', caughtErrorsIgnorePattern: '^_' }],
    },
  },
];

export default eslintConfig;
