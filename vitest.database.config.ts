import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['tests/database/**/*.test.ts'],
    restoreMocks: true,
    clearMocks: true,
    testTimeout: 30000,
    hookTimeout: 30000
  }
});
