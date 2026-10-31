import { PersonBankAccountsService } from './person-bank-accounts.service';

type Account = {
  id: string;
  personId: string;
  currency: string;
  isDefault: boolean;
  [k: string]: unknown;
};

/** Cuentas en memoria con la misma semántica de filtros que usa el servicio. */
function createFixture(initial: Account[] = []) {
  const accounts: Account[] = [...initial];
  let seq = 0;
  const matches = (a: Account, where: Record<string, any> = {}) =>
    Object.entries(where).every(([k, v]) =>
      v && typeof v === 'object' && 'not' in v ? a[k] !== v.not : a[k] === v,
    );

  // Como Prisma: la operación corre recién cuando se espera (o entra al $transaction).
  const lazy = <T>(fn: () => T) =>
    ({ then: (res: any, rej: any) => Promise.resolve().then(fn).then(res, rej) }) as PromiseLike<T>;

  const model = {
    findFirst: jest.fn(async ({ where }: any) => accounts.find((a) => matches(a, where)) ?? null),
    findMany: jest.fn(async ({ where }: any) => accounts.filter((a) => matches(a, where))),
    count: jest.fn(async ({ where }: any) => accounts.filter((a) => matches(a, where)).length),
    create: jest.fn(({ data }: any) =>
      lazy(() => {
        const row = { id: `acc-${++seq}`, ...data };
        accounts.push(row);
        return row;
      }),
    ),
    update: jest.fn(({ where, data }: any) =>
      lazy(() => {
        const row = accounts.find((a) => a.id === where.id)!;
        Object.assign(row, data);
        return row;
      }),
    ),
    updateMany: jest.fn(({ where, data }: any) =>
      lazy(() => {
        accounts.filter((a) => matches(a, where)).forEach((a) => Object.assign(a, data));
        return { count: 0 };
      }),
    ),
    delete: jest.fn(({ where }: any) => {
      accounts.splice(accounts.findIndex((a) => a.id === where.id), 1);
      return Promise.resolve({});
    }),
  };

  const prisma = {
    client: {
      person: {
        findFirst: jest.fn(async ({ where }: any) =>
          where.id === 'p1' ? { id: 'p1', firstName: 'Ana', lastName: 'Prueba' } : null,
        ),
      },
      personBankAccount: model,
      $transaction: jest.fn(async (ops: PromiseLike<unknown>[]) => Promise.all(ops)),
    },
  };
  const tenantContext = { getTenantId: () => 't1' };
  const service = new PersonBankAccountsService(prisma as any, tenantContext as any);
  return { service, accounts };
}

const validCbu = '0000000000000000000001';

describe('PersonBankAccountsService', () => {
  it('first account of a currency becomes the default even if not asked', async () => {
    const { service } = createFixture();
    const created = await service.create('p1', { currency: 'USD', cbu: validCbu, isDefault: false });
    expect(created.isDefault).toBe(true);
    expect(created.holder).toBe('Ana Prueba');
  });

  it('a second account of the same currency is not default unless requested', async () => {
    const { service } = createFixture();
    await service.create('p1', { currency: 'ARS', alias: 'uno' });
    const second = await service.create('p1', { currency: 'ARS', alias: 'dos' });
    expect(second.isDefault).toBe(false);
  });

  it('creating a default account demotes the previous default of that currency only', async () => {
    const { service, accounts } = createFixture();
    await service.create('p1', { currency: 'ARS', alias: 'ars-1' });
    await service.create('p1', { currency: 'USD', alias: 'usd-1' });
    await service.create('p1', { currency: 'ARS', alias: 'ars-2', isDefault: true });

    const ars = accounts.filter((a) => a.currency === 'ARS');
    expect(ars.filter((a) => a.isDefault).map((a) => a.alias)).toEqual(['ars-2']);
    expect(accounts.find((a) => a.alias === 'usd-1')!.isDefault).toBe(true);
  });

  it('promoting an account via update swaps the default', async () => {
    const { service, accounts } = createFixture();
    const first = await service.create('p1', { currency: 'ARS', alias: 'a' });
    const second = await service.create('p1', { currency: 'ARS', alias: 'b' });
    await service.update('p1', second.id, { isDefault: true });
    expect(accounts.find((a) => a.id === first.id)!.isDefault).toBe(false);
    expect(accounts.find((a) => a.id === second.id)!.isDefault).toBe(true);
  });

  it('refuses to unset the default directly (BANK_ACCOUNT_DEFAULT_REQUIRED)', async () => {
    const { service } = createFixture();
    const first = await service.create('p1', { currency: 'ARS', alias: 'a' });
    await expect(service.update('p1', first.id, { isDefault: false })).rejects.toMatchObject({
      response: { error: 'BANK_ACCOUNT_DEFAULT_REQUIRED' },
    });
  });

  it('refuses to delete the default while other accounts of the currency remain', async () => {
    const { service } = createFixture();
    const first = await service.create('p1', { currency: 'ARS', alias: 'a' });
    await service.create('p1', { currency: 'ARS', alias: 'b' });
    await expect(service.remove('p1', first.id)).rejects.toMatchObject({
      response: { error: 'BANK_ACCOUNT_DEFAULT_REQUIRED' },
    });
  });

  it('allows deleting the only account of a currency and non-default accounts', async () => {
    const { service, accounts } = createFixture();
    const first = await service.create('p1', { currency: 'ARS', alias: 'a' });
    const second = await service.create('p1', { currency: 'ARS', alias: 'b' });
    await service.remove('p1', second.id);
    await service.remove('p1', first.id);
    expect(accounts).toHaveLength(0);
  });

  it('rejects a malformed CBU and an unknown person or account', async () => {
    const { service } = createFixture();
    await expect(service.create('p1', { currency: 'ARS', cbu: '123' })).rejects.toMatchObject({
      response: { error: 'VALIDATION_ERROR' },
    });
    await expect(service.list('nope')).rejects.toMatchObject({
      response: { error: 'PERSON_NOT_FOUND' },
    });
    await expect(service.update('p1', 'missing', { alias: 'x' })).rejects.toMatchObject({
      response: { error: 'BANK_ACCOUNT_NOT_FOUND' },
    });
  });

  it('shortcut fields update the default ARS account or create it when absent', async () => {
    const { service, accounts } = createFixture();
    await service.applyShortcut('p1', { bankName: 'Banco Ficticio' }, 'Ana Prueba');
    expect(accounts).toHaveLength(1);
    expect(accounts[0]).toMatchObject({ currency: 'ARS', isDefault: true, bankName: 'Banco Ficticio' });

    await service.applyShortcut('p1', { bankAlias: 'ana.prueba' }, 'Ana Prueba');
    expect(accounts).toHaveLength(1);
    expect(accounts[0]).toMatchObject({ bankName: 'Banco Ficticio', alias: 'ana.prueba' });

    // Sin datos reales no se crea una cuenta vacía.
    const empty = createFixture();
    await empty.service.applyShortcut('p1', { bankName: null, cbu: null }, 'Ana Prueba');
    expect(empty.accounts).toHaveLength(0);
  });
});
