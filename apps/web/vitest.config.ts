import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  esbuild: { jsx: 'automatic' },
  test: {
    setupFiles: ['./test/setup.ts'],
    environment: 'node',
    include: ['src/**/*.{test,spec}.{ts,tsx}', 'test/**/*.{test,spec}.{ts,tsx}'],
    // La máquina de trabajo es chica: una sola corrida a la vez.
    pool: 'forks',
    poolOptions: { forks: { singleFork: true } },
    env: { TZ: 'UTC' },
    coverage: {
      provider: 'v8',
      // Todo el código de la web entra al informe: Sonar mide la cobertura del código nuevo en cualquier archivo.
      include: ['src/**/*.{ts,tsx}'],
      exclude: ['src/**/*.{test,spec}.{ts,tsx}', 'src/**/*.d.ts'],
      reporter: ['text', 'lcov', 'json-summary'],
      reportsDirectory: './coverage',
    },
  },
});
