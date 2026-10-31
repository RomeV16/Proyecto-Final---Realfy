#!/usr/bin/env node
// Puerta de duplicación: corre jscpd por paquete y falla si el porcentaje de
// líneas duplicadas supera el umbral del paquete. Sin dependencias propias.
//
//   node scripts/jscpd-gate.mjs
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

// Umbral = medición al fijarlo más un margen chico (docs/calidad/08-herramienta-sonarcloud.md).
// Se baja a medida que se extraen componentes y helpers; no se sube sin decisión explícita.
const packages = [
  { name: 'api', path: 'apps/api/src', threshold: 2.6 },
  { name: 'web', path: 'apps/web/src', threshold: 2.3 },
  { name: 'shared', path: 'packages/shared/src', threshold: 1.8 },
];

const ignore = [
  '**/*.spec.ts',
  '**/*.spec.tsx',
  '**/*.test.ts',
  '**/*.test.tsx',
  '**/__mocks__/**',
  '**/__tests__/**',
  '**/mocks/**',
  '**/fixtures/**',
  '**/generated/**',
  '**/*.d.ts',
  '**/*.json',
  '**/node_modules/**',
  '**/dist/**',
  '**/.next/**',
  '**/coverage/**',
].join(',');

let failed = false;
const out = mkdtempSync(join(tmpdir(), 'jscpd-'));
try {
  for (const pkg of packages) {
    const outDir = join(out, pkg.name);
    const run = spawnSync(
      join(root, 'node_modules', '.bin', 'jscpd'),
      [
        pkg.path,
        '--min-tokens', '70',
        '--min-lines', '5',
        '--ignore', ignore,
        '--reporters', 'json',
        '--output', outDir,
        '--silent',
        '--no-gitignore',
      ],
      { cwd: root, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, env: process.env },
    );
    if (run.error || run.status !== 0) {
      console.error(`jscpd falló en ${pkg.name}:`, run.error?.message ?? run.stderr ?? run.status);
      process.exit(2);
    }
    const { total } = JSON.parse(readFileSync(join(outDir, 'jscpd-report.json'), 'utf8')).statistics;
    const percentage = total.percentage;
    const ok = percentage <= pkg.threshold;
    failed ||= !ok;
    console.log(
      `${ok ? 'OK  ' : 'FAIL'} ${pkg.name}: ${percentage.toFixed(2)} % duplicado ` +
        `(umbral ${pkg.threshold.toFixed(1)} %, ${total.clones} clones, ${total.sources} archivos)`,
    );
  }
} finally {
  rmSync(out, { recursive: true, force: true });
}

if (failed) {
  console.error('La duplicación supera el umbral: extraé el código repetido a un helper o componente compartido.');
  process.exit(1);
}
