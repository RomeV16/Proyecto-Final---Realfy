import { ExecutionContext, ForbiddenException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { DEFAULT_READ_POLICY, UserRole } from '@realfy/shared';
import { firstValueFrom, of } from 'rxjs';
import { MASK_READS_KEY, READ_RESOURCE_KEY } from './read-resource.decorator';
import { ReadPolicyGuard } from './read-policy.guard';
import { ReadMaskInterceptor } from './read-mask.interceptor';
import { ReadPolicyService } from './read-policy.service';
import { fieldsToMask, maskFields } from './mask';

const RESTRICTED = {
  ...DEFAULT_READ_POLICY,
  'persons.bankAccounts': [UserRole.Admin, UserRole.Liquidaciones],
  'persons.document': [UserRole.Admin],
};

function ctx(_meta: Record<string, unknown>, user?: object): ExecutionContext {
  const handler = () => undefined;
  class Cls {}
  return {
    getHandler: () => handler,
    getClass: () => Cls,
    switchToHttp: () => ({ getRequest: () => ({ user }) }),
  } as unknown as ExecutionContext;
}

function reflectorFor(meta: Record<string, unknown>): Reflector {
  const reflector = new Reflector();
  jest
    .spyOn(reflector, 'getAllAndOverride')
    .mockImplementation((key) => meta[key as string] as never);
  return reflector;
}

function policies(impl: () => Promise<unknown>): ReadPolicyService {
  return { getPolicy: jest.fn(impl) } as unknown as ReadPolicyService;
}

describe('ReadPolicyGuard', () => {
  const user = (role: UserRole) => ({ role, tenantId: 't1' });

  it('deja pasar las rutas sin @ReadResource', async () => {
    const guard = new ReadPolicyGuard(reflectorFor({}), policies(async () => RESTRICTED));
    await expect(guard.canActivate(ctx({}, user(UserRole.Ventas)))).resolves.toBe(true);
  });

  it('deja pasar las rutas públicas', async () => {
    const guard = new ReadPolicyGuard(
      reflectorFor({ isPublic: true, [READ_RESOURCE_KEY]: 'audit' }),
      policies(async () => RESTRICTED),
    );
    await expect(guard.canActivate(ctx({}))).resolves.toBe(true);
  });

  it('permite al rol incluido en la política', async () => {
    const guard = new ReadPolicyGuard(
      reflectorFor({ [READ_RESOURCE_KEY]: 'persons.bankAccounts' }),
      policies(async () => RESTRICTED),
    );
    await expect(guard.canActivate(ctx({}, user(UserRole.Liquidaciones)))).resolves.toBe(true);
  });

  it('rechaza con READ_FORBIDDEN al rol excluido', async () => {
    const guard = new ReadPolicyGuard(
      reflectorFor({ [READ_RESOURCE_KEY]: 'persons.bankAccounts' }),
      policies(async () => RESTRICTED),
    );
    const err = await guard.canActivate(ctx({}, user(UserRole.Ventas))).catch((e) => e);
    expect(err).toBeInstanceOf(ForbiddenException);
    expect(err.getResponse()).toMatchObject({ error: 'READ_FORBIDDEN' });
  });

  it('falla cerrado si la política no se puede cargar', async () => {
    const guard = new ReadPolicyGuard(
      reflectorFor({ [READ_RESOURCE_KEY]: 'audit' }),
      policies(async () => {
        throw new Error('db caída');
      }),
    );
    await expect(guard.canActivate(ctx({}, user(UserRole.Admin)))).rejects.toBeInstanceOf(
      ForbiddenException,
    );
  });

  it('rechaza si no hay usuario', async () => {
    const guard = new ReadPolicyGuard(
      reflectorFor({ [READ_RESOURCE_KEY]: 'audit' }),
      policies(async () => DEFAULT_READ_POLICY),
    );
    await expect(guard.canActivate(ctx({}))).rejects.toBeInstanceOf(ForbiddenException);
  });
});

describe('ReadMaskInterceptor', () => {
  const body = { id: 'p1', dni: '123', cuit: '20-1-2', cbu: 'x', bankAccounts: [{ id: 1 }], name: 'A' };
  const handler = (b: unknown = body) => ({ handle: () => of(b) });
  const resources = ['persons.document', 'persons.bankAccounts'];

  it('no enmascara si el rol puede leer todo', async () => {
    const i = new ReadMaskInterceptor(
      reflectorFor({ [MASK_READS_KEY]: resources }),
      policies(async () => DEFAULT_READ_POLICY),
    );
    const out = await firstValueFrom(
      i.intercept(ctx({}, { role: UserRole.Ventas, tenantId: 't1' }), handler()) as never,
    );
    expect(out).toEqual(body);
  });

  it('enmascara solo los recursos que el rol no puede leer', async () => {
    const i = new ReadMaskInterceptor(
      reflectorFor({ [MASK_READS_KEY]: resources }),
      policies(async () => ({ ...DEFAULT_READ_POLICY, 'persons.document': [UserRole.Admin] })),
    );
    const out = await firstValueFrom(
      i.intercept(ctx({}, { role: UserRole.Ventas, tenantId: 't1' }), handler()) as never,
    );
    expect(out).toEqual({ ...body, dni: null, cuit: null });
  });

  it('el administrador ve todo con una política restrictiva', async () => {
    const i = new ReadMaskInterceptor(
      reflectorFor({ [MASK_READS_KEY]: resources }),
      policies(async () => RESTRICTED),
    );
    const out = await firstValueFrom(
      i.intercept(ctx({}, { role: UserRole.Admin, tenantId: 't1' }), handler()) as never,
    );
    expect(out).toEqual(body);
  });

  it('no toca rutas sin @MaskReads', async () => {
    const i = new ReadMaskInterceptor(reflectorFor({}), policies(async () => RESTRICTED));
    const out = await firstValueFrom(
      i.intercept(ctx({}, { role: UserRole.Ventas, tenantId: 't1' }), handler()) as never,
    );
    expect(out).toBe(body);
  });

  it('falla cerrado si la política no se puede cargar', async () => {
    const i = new ReadMaskInterceptor(
      reflectorFor({ [MASK_READS_KEY]: resources }),
      policies(async () => {
        throw new Error('db caída');
      }),
    );
    await expect(
      firstValueFrom(
        i.intercept(ctx({}, { role: UserRole.Admin, tenantId: 't1' }), handler()) as never,
      ),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('sin usuario enmascara todo', async () => {
    const i = new ReadMaskInterceptor(
      reflectorFor({ [MASK_READS_KEY]: resources }),
      policies(async () => DEFAULT_READ_POLICY),
    );
    const out = await firstValueFrom(i.intercept(ctx({}), handler()) as never);
    expect(out).toMatchObject({ dni: null, cuit: null, cbu: null, bankAccounts: null });
  });
});

describe('maskFields', () => {
  it('recorre arreglos y objetos anidados sin tocar fechas ni mutar la entrada', () => {
    const date = new Date('2026-01-01');
    const input = { list: [{ dni: '1', at: date, inner: { cuit: 'x', keep: 1 } }] };
    const out = maskFields(input, fieldsToMask(['persons.document']));
    expect(out).toEqual({ list: [{ dni: null, at: date, inner: { cuit: null, keep: 1 } }] });
    expect(input.list[0].dni).toBe('1');
    expect(out.list[0].at).toBe(date);
  });

  it('una comisión se enmascara como contracts.commission', () => {
    expect(maskFields({ commission: { type: 'x' }, id: 1 }, fieldsToMask(['contracts.commission']))).toEqual({
      commission: null,
      id: 1,
    });
  });
});

describe('ReadPolicyService', () => {
  const make = (row: unknown) => {
    const prisma = {
      baseClient: {
        tenant: {
          findUnique: jest.fn().mockResolvedValue(row),
          update: jest.fn().mockResolvedValue({}),
        },
      },
    };
    return { service: new ReadPolicyService(prisma as never), prisma };
  };

  it('null guardado resuelve la política por defecto', async () => {
    const { service } = make({ readPolicy: null });
    await expect(service.getPolicy('t1')).resolves.toEqual(DEFAULT_READ_POLICY);
  });

  it('devuelve la política guardada', async () => {
    const { service } = make({ readPolicy: RESTRICTED });
    await expect(service.getPolicy('t1')).resolves.toEqual(RESTRICTED);
  });

  it('lanza si la inmobiliaria no existe o lo guardado es inválido', async () => {
    await expect(make(null).service.getPolicy('x')).rejects.toThrow();
    await expect(make({ readPolicy: { audit: 1 } }).service.getPolicy('x')).rejects.toThrow();
  });

  it('guarda la política', async () => {
    const { service, prisma } = make({});
    await service.setPolicy('t1', RESTRICTED);
    expect(prisma.baseClient.tenant.update).toHaveBeenCalledWith({
      where: { id: 't1' },
      data: { readPolicy: RESTRICTED },
    });
  });
});
