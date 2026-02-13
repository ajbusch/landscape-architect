import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    projects: [
      {
        test: {
          name: 'unit',
          include: ['__tests__/unit/**/*.test.ts'],
          globals: true,
          coverage: {
            provider: 'v8',
            reporter: ['text', 'lcov'],
            include: ['src/**/*.ts'],
            exclude: ['src/index.ts'],
            thresholds: {
              statements: 85,
              branches: 90,
              functions: 85,
              lines: 85,
            },
          },
        },
      },
      {
        test: {
          name: 'integration',
          include: ['__tests__/integration/**/*.test.ts'],
          globals: true,
          testTimeout: 30000,
        },
      },
      {
        test: {
          name: 'contract',
          include: ['__tests__/contract/**/*.test.ts'],
          globals: true,
        },
      },
    ],
  },
});
