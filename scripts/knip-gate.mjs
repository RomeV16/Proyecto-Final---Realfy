#!/usr/bin/env node
// Puerta de código muerto: corre knip y falla sólo con hallazgos que no están
// en knip-baseline.json. Sin dependencias propias.
//
//   node scripts/knip-gate.mjs            compara contra la línea base
//   node scripts/knip-gate.mjs --update   regenera knip-baseline.json
import { spawnSync } from 'node:child_process';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const baselinePath = join(root, 'knip-baseline.json');
const update = process.argv.includes('--update');

const run = spawnSync(
  join(root, 'node_modules', '.bin', 'knip'),
  ['--include', 'files,exports,dependencies', '--reporter', 'json', '--no-progress'],
  { cwd: root, encoding: 'utf8', maxBuffer: 256 * 1024 * 1024, env: process.env },
);

// knip sale con 1 cuando hay hallazgos; cualquier otro código o ausencia de JSON es un error de la herramienta.
if (run.error || (run.status !== 0 && run.status !== 1) || !run.stdout.trim().startsWith('{')) {
  console.error('knip no pudo ejecutarse:', run.error?.message ?? run.stderr ?? run.status);
  process.exit(2);
}

const report = JSON.parse(run.stdout);
const categories = [
  'dependencies',
  'devDependencies',
  'optionalPeerDependencies',
  'unlisted',
  'binaries',
  'unresolved',
  'exports',
];

// Cada hallazgo se identifica por categoría, archivo y nombre (sin línea, que se mueve con cualquier edición).
const findings = new Set((report.files ?? []).map((file) => `files|${file}|`));
for (const issue of report.issues ?? []) {
  for (const category of categories) {
    for (const item of issue[category] ?? []) {
      findings.add(`${category}|${issue.file}|${item.name}`);
    }
  }
}
const current = [...findings].sort();

if (update) {
  writeFileSync(baselinePath, JSON.stringify({ findings: current }, null, 2) + '\n');
  console.log(`knip-baseline.json actualizado: ${current.length} hallazgos.`);
  process.exit(0);
}

const baseline = new Set(
  existsSync(baselinePath) ? JSON.parse(readFileSync(baselinePath, 'utf8')).findings : [],
);
const fresh = current.filter((finding) => !baseline.has(finding));
const fixed = [...baseline].filter((finding) => !findings.has(finding));

const show = (finding) => {
  const [category, file, name] = finding.split('|');
  return `  ${category}: ${file}${name ? ` -> ${name}` : ''}`;
};

if (fixed.length > 0) {
  console.log(`Hallazgos de la línea base ya resueltos (${fixed.length}); corré pnpm knip:baseline para quitarlos:`);
  fixed.forEach((finding) => console.log(show(finding)));
}
if (fresh.length > 0) {
  console.error(`knip: ${fresh.length} hallazgo(s) nuevo(s) de código muerto o dependencias sin uso:`);
  fresh.forEach((finding) => console.error(show(finding)));
  console.error('Quitá el código, o si es una falsa alarma ajustá knip.json y explicalo en docs/calidad/08-herramienta-sonarcloud.md.');
  process.exit(1);
}
console.log(`knip: sin hallazgos nuevos (${current.length} en la línea base).`);
