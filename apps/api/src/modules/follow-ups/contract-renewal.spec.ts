import { ContractRenewalService } from './contract-renewal.service';
import { RenewalAddendumPdfService } from './renewal-addendum-pdf.service';

const utc = (y: number, m: number, d: number) => new Date(Date.UTC(y, m - 1, d));
const input = { start: '2027-01-01', end: '2028-12-31', rent: '200000' };

function build(over: { contract?: any; last?: any; laterTerms?: number; guarantors?: string[] } = {}) {
  const contract = over.contract === undefined ? { id: 'c1', status: 'Activo', endDate: utc(2026, 12, 31), actualEndDate: null, rentAmount: '100000' } : over.contract;
  const tx = {
    contractPeriod: { create: jest.fn() },
    contract: { update: jest.fn() },
  };
  const prisma = {
    client: {
      contract: { findFirst: jest.fn().mockResolvedValue(contract) },
      contractPeriod: {
        findFirst: jest.fn().mockResolvedValue(over.last === undefined ? { seq: 1, startDate: utc(2025, 1, 1) } : over.last),
      },
      contractTermsVersion: { count: jest.fn().mockResolvedValue(over.laterTerms ?? 0) },
      contractPerson: {
        findMany: jest.fn().mockResolvedValue((over.guarantors ?? []).map((personId) => ({ personId }))),
      },
    },
  };
  const rules = {
    createAgreement: jest.fn(async (_id: string, _data: unknown, hook: any) => {
      await hook(tx, 'a1');
    }),
    listPeriods: jest.fn().mockResolvedValue([{ seq: 1 }, { seq: 2 }]),
  };
  const contracts = {
    rebuildPendingSchedule: jest.fn(),
    findOne: jest.fn().mockResolvedValue({ id: 'c1' }),
    reactivateExpired: jest.fn(),
  };
  const followUps = { closeOpenForContract: jest.fn().mockResolvedValue(1) };
  const audit = { record: jest.fn() };
  const service = new ContractRenewalService(
    prisma as any,
    { getTenantId: () => 't1' } as any,
    audit as any,
    rules as any,
    contracts as any,
    followUps as any,
  );
  return { service, tx, rules, contracts, followUps, audit, prisma };
}

describe('ContractRenewalService', () => {
  it('crea el convenio con el alquiler y la regla, agrega el período y cierra el seguimiento', async () => {
    const stranger = build({ guarantors: [] });
    await expect(
      stranger.service.renew('c1', { ...input, guarantorPersonIds: ['0d9bdf7e-8f4c-4a52-9d8e-5b3b4a6b3c11'] }),
    ).rejects.toMatchObject({ response: { error: 'GUARANTOR_NOT_IN_CONTRACT' } });
    expect(stranger.rules.createAgreement).not.toHaveBeenCalled();
    expect(stranger.tx.contractPeriod.create).not.toHaveBeenCalled();

    const g = '0d9bdf7e-8f4c-4a52-9d8e-5b3b4a6b3c11';
    const ok = build({ guarantors: [g] });
    const res = await ok.service.renew('c1', {
      ...input,
      adjustment: { adjustmentType: 'IPC', adjustmentPeriod: 'Anual' },
      guarantorPersonIds: [g],
      fee: { amount: '96000', currency: 'ARS' },
      signedAt: '2026-12-15',
    });
    const [, agreement] = ok.rules.createAgreement.mock.calls[0];
    expect(agreement).toMatchObject({
      kind: 'Renovacion',
      effectiveFrom: utc(2027, 1, 1),
      effectiveTo: utc(2028, 12, 31),
      termsPatch: { rentOverride: '200000', adjustmentType: 'IPC', adjustmentPeriod: 'Anual' },
    });
    expect(ok.tx.contractPeriod.create.mock.calls[0][0].data).toMatchObject({
      seq: 2,
      kind: 'Renovacion',
      initialRent: '200000',
      feeAmount: '96000',
      feeCurrency: 'ARS',
      guarantorPersonIds: [g],
      signedAt: utc(2026, 12, 15),
    });
    expect(ok.tx.contract.update.mock.calls[0][0].data).toEqual({ endDate: utc(2028, 12, 31), actualEndDate: null });
    expect(ok.followUps.closeOpenForContract).toHaveBeenCalledWith(ok.tx, 'c1', 'Renovado');
    expect(ok.audit.record.mock.calls[0][1].metadata.operation).toBe('renewal');
    expect(ok.contracts.rebuildPendingSchedule).toHaveBeenCalledWith('c1');
    expect(res.period).toEqual({ seq: 2 });
  });

  it('actualiza el alquiler vigente solo si la renovación ya rige', async () => {
    const future = build();
    await future.service.renew('c1', { start: '2999-01-01', end: '2999-12-31', rent: '1' });
    expect(future.tx.contract.update.mock.calls[0][0].data.rentAmount).toBeUndefined();
    const started = build({ last: { seq: 1, startDate: utc(2019, 1, 1) } });
    await started.service.renew('c1', { start: '2020-01-01', end: '2021-01-01', rent: '150000' });
    expect(started.tx.contract.update.mock.calls[0][0].data.rentAmount).toBe('150000');
  });

  it.each([
    ['contrato inexistente', { contract: null }, 'CONTRACT_NOT_FOUND'],
    ['contrato rescindido', { contract: { id: 'c1', status: 'Rescindido' } }, 'CONTRACT_NOT_ACTIVE'],
    ['inicio anterior al del período', { last: { seq: 1, startDate: utc(2027, 6, 1) } }, 'RENEWAL_BEFORE_PERIOD_START'],
    ['reglas posteriores', { laterTerms: 1 }, 'TERMS_VERSION_EXISTS'],
  ])('rechaza: %s', async (_name, over, code) => {
    const { service, rules } = build(over as any);
    await expect(service.renew('c1', input)).rejects.toMatchObject({ response: { error: code } });
    expect(rules.createAgreement).not.toHaveBeenCalled();
  });

  it('renueva un contrato vencido: lo reactiva con el fin nuevo y lo audita', async () => {
    const expired = { id: 'c1', status: 'Vencido', endDate: utc(2026, 12, 31), actualEndDate: null, rentAmount: '100000' };
    const { service, tx, contracts, audit } = build({ contract: expired });
    await service.renew('c1', input);
    expect(contracts.reactivateExpired).toHaveBeenCalledWith(tx, expired, utc(2028, 12, 31));
    const entry = audit.record.mock.calls[0][1];
    expect(entry.before.status).toBe('Vencido');
    expect(entry.after.status).toBe('Activo');
    expect(entry.metadata.reactivated).toBe(true);
  });

  it('valida el cuerpo', async () => {
    const { service } = build();
    await expect(service.renew('c1', { ...input, end: input.start })).rejects.toMatchObject({ status: 400 });
  });
});

describe('RenewalAddendumPdfService', () => {
  const person = (firstName: string) => ({ firstName, lastName: 'Sintético' });
  function make(period: any) {
    const render = jest.fn().mockResolvedValue(Buffer.from('%PDF-1'));
    const prisma = {
      client: {
        contract: {
          findFirst: jest.fn().mockResolvedValue({
            id: 'c1',
            startDate: utc(2025, 1, 1),
            rentCurrency: 'ARS',
            property: { title: 'Depto 1', street: 'Calle Ficticia', number: '100' },
            persons: [{ role: 'Inquilino', person: person('Ines') }],
            lessors: [{ person: person('Luis') }],
          }),
        },
        contractPeriod: { findFirst: jest.fn().mockResolvedValue(period) },
        contractTermsVersion: {
          findFirst: jest.fn().mockResolvedValue({ adjustmentType: 'IPC', adjustmentPeriod: 'Trimestral' }),
        },
        tenant: { findFirst: jest.fn().mockResolvedValue({ name: 'Inmobiliaria Sintética', cuit: '30-00000000-0' }) },
        person: { findMany: jest.fn().mockResolvedValue([person('Gabriela')]) },
      },
    };
    const service = new RenewalAddendumPdfService(prisma as any, { getTenantId: () => 't1' } as any, { render } as any);
    return { service, render, prisma };
  }
  const renewal = {
    kind: 'Renovacion',
    startDate: utc(2027, 1, 1),
    endDate: utc(2028, 12, 31),
    initialRent: { toString: () => '200000' },
    guarantorPersonIds: ['g1'],
    feeAmount: { toString: () => '96000' },
    feeCurrency: 'ARS',
    signedAt: null,
  };

  it('arma la adenda con período, alquiler, regla, garantes y honorarios', async () => {
    const { service, render } = make(renewal);
    const out = await service.pdf('c1', 2);
    expect(out.filename).toBe('adenda-renovacion-2.pdf');
    const text = JSON.stringify(render.mock.calls[0][0].content);
    for (const fragment of ['ADENDA DE RENOVACIÓN', '01/01/2027', '31/12/2028', 'Luis', 'Ines', 'Gabriela', 'trimestralmente', 'honorarios']) {
      expect(text).toContain(fragment);
    }
  });

  it('sin garantes ni honorarios mantiene las garantías y omite la cláusula de honorarios', async () => {
    const { service, render } = make({ ...renewal, guarantorPersonIds: [], feeAmount: null, signedAt: utc(2026, 12, 20) });
    await service.pdf('c1', 2);
    const text = JSON.stringify(render.mock.calls[0][0].content);
    expect(text).toContain('se mantienen vigentes');
    expect(text).not.toContain('Quinta');
    expect(text).toContain('Firmada el 20/12/2026');
  });

  it('rechaza un período que no es renovación o no existe', async () => {
    await expect(make({ ...renewal, kind: 'Original' }).service.pdf('c1', 1)).rejects.toMatchObject({
      response: { error: 'PERIOD_NOT_A_RENEWAL' },
    });
    await expect(make(null).service.pdf('c1', 9)).rejects.toMatchObject({ response: { error: 'PERIOD_NOT_FOUND' } });
  });
});
