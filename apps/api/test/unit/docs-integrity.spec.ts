import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

const DOCS = join(__dirname, '../../../../docs');

function markdownFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) out.push(...markdownFiles(full));
    else if (entry.endsWith('.md')) out.push(full);
  }
  return out.sort((a, b) => a.localeCompare(b));
}

/**
 * Un merge mal resuelto deja las marcas de conflicto dentro de un documento
 * (DEF-95: pasó en los casos de uso). Ningún documento las puede tener.
 */
describe('integridad de la documentación', () => {
  it('ningún documento tiene marcas de conflicto de un merge', () => {
    const offenders: string[] = [];
    for (const file of markdownFiles(DOCS)) {
      const lines = readFileSync(file, 'utf8').split('\n');
      lines.forEach((line, i) => {
        if (/^(<<<<<<< |>>>>>>> |=======$)/.test(line)) offenders.push(`${file.slice(DOCS.length + 1)}:${i + 1}`);
      });
    }
    expect(offenders).toEqual([]);
  });
});
