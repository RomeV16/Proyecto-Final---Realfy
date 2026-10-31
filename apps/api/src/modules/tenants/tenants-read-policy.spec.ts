import { BadRequestException, ForbiddenException } from '@nestjs/common';
import { DEFAULT_READ_POLICY, READ_RESOURCES, UserRole } from '@realfy/shared';
import { TenantsService } from './tenants.service';

describe('TenantsService — política de lectura', () => {
  const build = (tenantId: string | undefined, role?: UserRole, stored = DEFAULT_READ_POLICY) => {
    const policies = {
      getPolicy: jest.fn().mockResolvedValue(stored),
      setPolicy: jest.fn(async (_t: string, p: unknown) => p),
    };
    const ctx = { getTenantId: () => tenantId, getUserRole: () => role };
    const service = new TenantsService({} as never, ctx as never, policies as never, {} as never);
    return { service, policies };
  };

  it('devuelve la política de la inmobiliaria del usuario', async () => {
    const { service, policies } = build('t1');
    await expect(service.getReadPolicy()).resolves.toEqual(DEFAULT_READ_POLICY);
    expect(policies.getPolicy).toHaveBeenCalledWith('t1');
  });

  it('exige contexto de inmobiliaria', async () => {
    await expect(build(undefined).service.getReadPolicy()).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('guarda una política válida y rechaza una inválida con 400', async () => {
    const { service, policies } = build('t1');
    await service.updateReadPolicy(DEFAULT_READ_POLICY);
    expect(policies.setPolicy).toHaveBeenCalledWith('t1', DEFAULT_READ_POLICY);
    await expect(
      service.updateReadPolicy({ ...DEFAULT_READ_POLICY, audit: [UserRole.Gerente] }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('informa qué recursos puede leer el rol actual', async () => {
    const stored = { ...DEFAULT_READ_POLICY, audit: [UserRole.Admin] };
    const { service } = build('t1', UserRole.Ventas, stored);
    const access = await service.getReadAccess();
    expect(access.role).toBe(UserRole.Ventas);
    expect(access.resources.audit).toBe(false);
    expect(Object.keys(access.resources)).toEqual([...READ_RESOURCES]);
    expect(access.resources.invoices).toBe(true);
  });
});
