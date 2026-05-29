import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['tests/**/*.test.ts'],
    coverage: {
      reporter: ['text', 'json-summary'],
      thresholds: {
        lines: 80,
        functions: 80,
        statements: 80,
      },
    },
  },
});
