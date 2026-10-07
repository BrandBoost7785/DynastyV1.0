import { defineConfig } from 'vitest/config';
import { fileURLToPath } from 'node:url';

export default defineConfig({
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts', 'tests/**/*.test.tsx'],
    // Deterministic simulation tests must never be order-dependent.
    sequence: { concurrent: false },
    testTimeout: 60_000,
    hookTimeout: 60_000,
    pool: 'forks',
    reporters: ['default'],
    coverage: {
      provider: 'v8',
      include: ['src/sim/**', 'src/engine/**', 'src/server/**', 'src/persistence/**'],
      reporter: ['text-summary'],
    },
  },
});
