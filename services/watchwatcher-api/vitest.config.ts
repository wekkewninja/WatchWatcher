import { resolve } from 'node:path';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  root: resolve(__dirname, '..'),
  test: {
    environment: 'node',
    include: ['watchwatcher-api/tests/**/*.test.ts'],
    fileParallelism: false,
    testTimeout: 10000,
    teardownTimeout: 3000,
    coverage: {
      include: ['watchwatcher-api/src/**/*.ts', 'shared/**/*.ts'],
      exclude: ['**/*.d.ts', '**/*.test.ts', '**/*.spec.ts'],
      reporter: ['json-summary', 'text-summary'],
      reportsDirectory: 'watchwatcher-api/coverage',
    },
  },
});
