import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  resolve: {
    alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) },
  },
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts', 'src/**/*.test.ts'],
    // the PGlite database tests boot a WASM Postgres in beforeAll
    hookTimeout: 90_000,
    testTimeout: 20_000,
    coverage: {
      provider: 'v8',
      include: ['src/core/**', 'src/guesty/**', 'src/sync/**', 'src/db/**'],
    },
  },
});
