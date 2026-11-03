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

  it('el catálogo de casos de prueba no repite ningún identificador CP', () => {
    const text = readFileSync(join(DOCS, 'calidad/05-casos-de-prueba.md'), 'utf8');
    const seen = new Map<string, number>();
    const duplicated: string[] = [];
    text.split('\n').forEach((line, i) => {
      const id = /^\| (CP-\d+) \|/.exec(line)?.[1];
      if (!id) return;
      if (seen.has(id)) duplicated.push(`${id} (líneas ${seen.get(id)} y ${i + 1})`);
      else seen.set(id, i + 1);
    });
    expect(duplicated).toEqual([]);
  });
});
