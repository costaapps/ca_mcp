import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts'],
    exclude: ['tests/database/**'],
    restoreMocks: true,
    clearMocks: true
  }
});
