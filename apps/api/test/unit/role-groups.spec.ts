import 'reflect-metadata';
import { readFileSync, writeFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { UserRole } from '@realfy/shared';
import { ROLES_KEY } from '../../src/common/auth/roles.decorator';
import {
  ADMIN_ONLY,
  ALL_STAFF,
  BILLING_READ_ROLES,
  BILLING_ROLES,
  BILLING_VIEW_ROLES,
  MANAGEMENT_ROLES,
  MARKETING_ROLES,
  SALES_MARKETING_ROLES,
  SALES_ROLES,
  SUPPORT_ROLES,
} from '../../src/common/auth/role-groups';

const API_ROOT = join(__dirname, '../..');
const GOLDEN = join(__dirname, 'fixtures', 'route-roles.golden.json');

function controllerFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) out.push(...controllerFiles(full));
    else if (entry.endsWith('.controller.ts')) out.push(full);
  }
  return out;
}

function effectiveRoles(): Record<string, string[] | null> {
  const out: Record<string, string[] | null> = {};
  for (const file of controllerFiles(join(API_ROOT, 'src/modules')).sort()) {
    const rel = file.slice(API_ROOT.length + 1);
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const mod = require(file) as Record<string, unknown>;
    for (const exp of Object.values(mod)) {
      if (typeof exp !== 'function' || !exp.prototype) continue;
      if (!Reflect.getMetadata('path', exp)) continue;
      const classRoles = Reflect.getMetadata(ROLES_KEY, exp) as string[] | undefined;
      for (const name of Object.getOwnPropertyNames(exp.prototype)) {
        const handler = (exp.prototype as Record<string, unknown>)[name];
        if (name === 'constructor' || typeof handler !== 'function') continue;
        if (Reflect.getMetadata('method', handler) === undefined) continue;
        const own = Reflect.getMetadata(ROLES_KEY, handler) as string[] | undefined;
        const eff = own ?? classRoles;
        out[`${rel}#${exp.name}.${name}`] = eff ? [...eff].sort() : null;
      }
    }
  }
  return out;
}

describe('grupos de roles', () => {
  it('cada grupo tiene la membresía esperada', () => {
    const s = (g: readonly UserRole[]) => [...g].sort();
    const A = UserRole.Admin;
    const G = UserRole.Gerente;
    expect(s(ADMIN_ONLY)).toEqual(s([A]));
    expect(s(MANAGEMENT_ROLES)).toEqual(s([A, G]));
    expect(s(SALES_ROLES)).toEqual(s([A, G, UserRole.Ventas]));
    expect(s(BILLING_ROLES)).toEqual(s([A, G, UserRole.Liquidaciones]));
    expect(s(SUPPORT_ROLES)).toEqual(s([A, G, UserRole.Soporte]));
    expect(s(MARKETING_ROLES)).toEqual(s([A, G, UserRole.Marketing]));
    expect(s(SALES_MARKETING_ROLES)).toEqual(s([A, G, UserRole.Ventas, UserRole.Marketing]));
    expect(s(BILLING_READ_ROLES)).toEqual(s([A, G, UserRole.Liquidaciones, UserRole.Lectura]));
    expect(s(BILLING_VIEW_ROLES)).toEqual(
      s([A, G, UserRole.Liquidaciones, UserRole.Lectura, UserRole.Ventas, UserRole.Soporte]),
    );
    expect(s(ALL_STAFF)).toEqual(s(Object.values(UserRole)));
  });

  it('los roles efectivos de cada ruta no cambian respecto de la referencia', () => {
    const actual = effectiveRoles();
    if (process.env.UPDATE_ROUTE_ROLES === '1') {
      writeFileSync(GOLDEN, JSON.stringify(actual, null, 2) + '\n');
    }
    const golden = JSON.parse(readFileSync(GOLDEN, 'utf8'));
    expect(actual).toEqual(golden);
    expect(Object.keys(actual).length).toBeGreaterThan(200);
  });
});
