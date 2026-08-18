import { readFileSync } from 'fs';
import { join } from 'path';

/**
 * La lista de modelos alcanzados por el filtro de inmobiliaria se mantiene a
 * mano, asi que un modelo nuevo con columna tenantId puede quedar afuera sin
 * que nada falle: sus consultas pasarian sin filtrar. Esta prueba compara la
 * lista contra el esquema para que ese olvido rompa la suite.
 */
describe('modelos alcanzados por el filtro de inmobiliaria', () => {
  const schema = readFileSync(
    join(__dirname, '..', '..', 'prisma', 'schema.prisma'),
    'utf8',
  );
  const extension = readFileSync(
    join(__dirname, '..', '..', 'src', 'common', 'tenant', 'prisma-tenant.extension.ts'),
    'utf8',
  );

  /** Modelos del esquema que declaran una columna tenantId. */
  const modelsWithTenantId = (): string[] => {
    const found: string[] = [];
    const modelBlock = /^model (\w+) \{([\s\S]*?)^\}/gm;
    let match: RegExpExecArray | null;
    while ((match = modelBlock.exec(schema)) !== null) {
      const [, name, body] = match;
      if (/^\s*tenantId\s/m.test(body)) found.push(name);
    }
    return found;
  };

  /** Nombres declarados en el conjunto TENANT_SCOPED_MODELS. */
  const scopedModels = (): string[] => {
    const block = /TENANT_SCOPED_MODELS = new Set\(\[([\s\S]*?)\]\);/.exec(extension);
    if (!block) throw new Error('no se encontro TENANT_SCOPED_MODELS en la extension');
    return [...block[1].matchAll(/'([A-Za-z]+)'/g)].map((m) => m[1]);
  };

  const allModels = (): string[] =>
    [...schema.matchAll(/^model (\w+) \{/gm)].map((m) => m[1]);

  it('cubre todos los modelos que tienen columna tenantId', () => {
    const scoped = new Set(scopedModels());
    const missing = modelsWithTenantId().filter((m) => !scoped.has(m));
    expect(missing).toEqual([]);
  });

  it('no nombra modelos que no existen en el esquema', () => {
    const existing = new Set(allModels());
    const stale = scopedModels().filter((m) => !existing.has(m));
    expect(stale).toEqual([]);
  });

  it('incluye a Tenant, que se filtra por su propia clave', () => {
    expect(scopedModels()).toContain('Tenant');
  });
});
