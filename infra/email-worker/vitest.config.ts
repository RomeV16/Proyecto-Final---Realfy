import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
    // Los casos de CP-1419 arman adjuntos de hasta 24 MiB: con cobertura, en CI pasan los 5 s por defecto.
    testTimeout: 30_000,
    coverage: { provider: 'v8', include: ['src/**/*.ts'], exclude: ['src/**/*.test.ts', 'src/fixtures.ts', 'src/types.ts'], reporter: ['text', 'lcov'] },
  },
});
