import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['tests/**/*.test.ts'],
    testTimeout: 120_000,
    hookTimeout: 60_000,
    pool: 'forks',
    // Default reporter; mantenemos un único worker para tests que comparten DB.
    fileParallel: false,
    sequence: { concurrent: false },
    env: {
      NODE_ENV: 'test',
      LOG_LEVEL: process.env.LOG_LEVEL ?? 'warn',
    },
  },
});
