import { UserRole } from '../enums';
import {
  DEFAULT_READ_POLICY,
  READ_RESOURCES,
  ReadPolicySchema,
  canReadResource,
  resolveReadPolicy,
} from './read-policy.schema';

describe('política de lectura', () => {
  it('sin configurar, todos los roles leen todos los recursos', () => {
    const policy = resolveReadPolicy(null);
    for (const resource of READ_RESOURCES) {
      for (const role of Object.values(UserRole)) {
        expect(canReadResource(policy, resource, role)).toBe(true);
      }
    }
    expect(resolveReadPolicy(undefined)).toBe(DEFAULT_READ_POLICY);
  });

  it('una política guardada restringe solo lo configurado', () => {
    const stored = {
      ...DEFAULT_READ_POLICY,
      'persons.bankAccounts': [UserRole.Admin, UserRole.Liquidaciones],
    };
    const policy = resolveReadPolicy(stored);
    expect(canReadResource(policy, 'persons.bankAccounts', UserRole.Ventas)).toBe(false);
    expect(canReadResource(policy, 'persons.bankAccounts', UserRole.Liquidaciones)).toBe(true);
    expect(canReadResource(policy, 'persons.document', UserRole.Ventas)).toBe(true);
  });

  it('exige que Admin siempre pueda leer', () => {
    const res = ReadPolicySchema.safeParse({
      ...DEFAULT_READ_POLICY,
      audit: [UserRole.Gerente],
    });
    expect(res.success).toBe(false);
  });

  it('rechaza recursos desconocidos y roles inválidos', () => {
    expect(ReadPolicySchema.safeParse({ ...DEFAULT_READ_POLICY, otro: [] }).success).toBe(false);
    expect(
      ReadPolicySchema.safeParse({ ...DEFAULT_READ_POLICY, audit: ['Admin', 'Dios'] }).success,
    ).toBe(false);
  });

  it('un valor guardado inválido lanza, no cae al valor por defecto', () => {
    expect(() => resolveReadPolicy({ audit: 'x' })).toThrow();
  });

  it('sin rol no se puede leer', () => {
    expect(canReadResource(DEFAULT_READ_POLICY, 'audit', null)).toBe(false);
  });
});
