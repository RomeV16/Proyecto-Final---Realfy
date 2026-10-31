import { readFileSync } from 'fs';
import { join } from 'path';

/**
 * Los enums viven por duplicado: en el esquema de Prisma (lo que acepta la
 * base) y en el paquete compartido (lo que usan la API y la web para validar
 * y mostrar). Nada obliga a mantenerlos iguales, asi que un valor agregado de
 * un solo lado se descubre en produccion. Esta prueba compara ambos y falla
 * ante cualquier diferencia que no este en las listas de abajo.
 *
 * Las listas registran la deriva conocida al dia de hoy. Cada entrada nueva
 * debe tener una razon escrita; las que se corrijan se borran de la lista.
 */

/** Enums que existen en shared y no en Prisma (no son enum de base de datos). */
const SOLO_EN_SHARED = ['Province'];

/** Enums que existen en Prisma y no en shared. */
const SOLO_EN_PRISMA = [
  'ArcaDelegationStatus',
  'ClosureSummarySource',
  'PenaltyStatus',
];

/** Valores presentes en Prisma y ausentes en shared, por enum. */
const VALORES_SOLO_EN_PRISMA: Record<string, string[]> = {
  // Estado heredado: la maquina de estados de shared no lo conoce. Se corrige en B11.
  LiquidacionStatus: ['Pendiente'],
};

/** Valores presentes en shared y ausentes en Prisma, por enum. */
const VALORES_SOLO_EN_SHARED: Record<string, string[]> = {};

const read = (...parts: string[]) =>
  readFileSync(join(__dirname, '..', '..', ...parts), 'utf8');

/** Enums del esquema: nombre -> valores. */
const prismaEnums = (): Map<string, string[]> => {
  const schema = read('prisma', 'schema.prisma');
  const found = new Map<string, string[]>();
  const block = /^enum (\w+) \{([\s\S]*?)^\}/gm;
  let match: RegExpExecArray | null;
  while ((match = block.exec(schema)) !== null) {
    const [, name, body] = match;
    const values = body
      .split('\n')
      .map((line) => line.replace(/\/\/.*$/, '').trim())
      .filter((line) => line.length > 0)
      .map((line) => line.split(/\s+/)[0]);
    found.set(name, values);
  }
  return found;
};

/** Enums exportados por shared: nombre -> valores (el literal de cada miembro). */
const sharedEnums = (): Map<string, string[]> => {
  const source = readFileSync(
    join(__dirname, '..', '..', '..', '..', 'packages', 'shared', 'src', 'enums.ts'),
    'utf8',
  );
  const found = new Map<string, string[]>();
  const block = /^export enum (\w+) \{([\s\S]*?)^\}/gm;
  let match: RegExpExecArray | null;
  while ((match = block.exec(source)) !== null) {
    const [, name, body] = match;
    const values = [...body.matchAll(/^\s*\w+\s*=\s*'([^']*)'/gm)].map((m) => m[1]);
    found.set(name, values);
  }
  return found;
};

const sorted = (values: string[]) => [...values].sort();

describe('paridad de enums entre Prisma y shared', () => {
  const prisma = prismaEnums();
  const shared = sharedEnums();

  it('lee enums de ambos lados', () => {
    expect(prisma.size).toBeGreaterThan(20);
    expect(shared.size).toBeGreaterThan(20);
    expect(prisma.get('UserRole')).toEqual(expect.arrayContaining(['Admin']));
    expect(shared.get('UserRole')).toEqual(expect.arrayContaining(['Admin']));
  });

  it('todo enum de shared existe en Prisma, salvo los registrados', () => {
    const faltantes = [...shared.keys()].filter(
      (name) => !prisma.has(name) && !SOLO_EN_SHARED.includes(name),
    );
    expect(faltantes).toEqual([]);
  });

  it('todo enum de Prisma existe en shared, salvo los registrados', () => {
    const faltantes = [...prisma.keys()].filter(
      (name) => !shared.has(name) && !SOLO_EN_PRISMA.includes(name),
    );
    expect(faltantes).toEqual([]);
  });

  it('las listas de excepciones no nombran enums que ya no existen o ya coinciden', () => {
    const vencidas = [
      ...SOLO_EN_SHARED.filter((n) => !shared.has(n) || prisma.has(n)),
      ...SOLO_EN_PRISMA.filter((n) => !prisma.has(n) || shared.has(n)),
    ];
    expect(vencidas).toEqual([]);
  });

  describe('valores de los enums presentes en ambos lados', () => {
    const comunes = [...prisma.keys()].filter((name) => shared.has(name)).sort();

    it.each(comunes)('%s tiene los mismos valores, salvo los registrados', (name) => {
      const enPrisma = prisma.get(name) ?? [];
      const enShared = shared.get(name) ?? [];
      const soloPrisma = enPrisma.filter((v) => !enShared.includes(v));
      const soloShared = enShared.filter((v) => !enPrisma.includes(v));

      expect(sorted(soloPrisma)).toEqual(sorted(VALORES_SOLO_EN_PRISMA[name] ?? []));
      expect(sorted(soloShared)).toEqual(sorted(VALORES_SOLO_EN_SHARED[name] ?? []));
    });
  });

  it('las excepciones por valor se refieren a enums comunes', () => {
    const nombres = [
      ...Object.keys(VALORES_SOLO_EN_PRISMA),
      ...Object.keys(VALORES_SOLO_EN_SHARED),
    ];
    const ajenos = nombres.filter((n) => !prisma.has(n) || !shared.has(n));
    expect(ajenos).toEqual([]);
  });
});
