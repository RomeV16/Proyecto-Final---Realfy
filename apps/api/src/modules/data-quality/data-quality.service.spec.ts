import { BadRequestException } from '@nestjs/common';
import { DATA_QUALITY_CHECKS } from '@realfy/shared';
import { DataQualityService } from './data-quality.service';

const NOW = new Date('2026-06-15T12:00:00Z');
const dec = (n: number) => ({ toString: () => String(n) });

function makeService() {
  const client = {
    person: {
      findMany: jest.fn().mockResolvedValue([
        { id: 'a', firstName: 'Ana', lastName: 'Uno', email: 'x@ejemplo.com', phone: null, phone2: null, cuit: '20-12345678-6', dni: null, personType: 'Fisica', payoutMethod: 'Transferencia', roles: [{ role: 'Propietario' }] },
        { id: 'b', firstName: 'Ana', lastName: 'Uno', email: 'X@ejemplo.com', phone: null, phone2: null, cuit: '20123456786', dni: null, personType: 'Fisica', payoutMethod: null, roles: [] },
      ]),
    },
    personBankAccount: { findMany: jest.fn().mockResolvedValue([]) },
    property: { findMany: jest.fn().mockResolvedValue([{ id: 'p1', title: 'Casa' }]) },
    propertyOwnership: {
      findMany: jest.fn().mockResolvedValue([{ propertyId: 'p1', personId: 'a', sharePct: dec(40), since: null, until: null }]),
    },
    contractLessor: {
      findMany: jest.fn().mockResolvedValue([
        { contractId: 'c1', personId: 'a', payoutPct: dec(70), validFrom: new Date('2025-01-01'), validTo: null },
      ]),
    },
    contract: {
      findMany: jest.fn().mockResolvedValue([
        {
          id: 'c1', status: 'Activo', propertyId: 'p1', endDate: new Date('2027-01-01'), actualEndDate: null, closedAt: null,
          rentAmount: dec(0), adjustmentType: 'IPC', customAdjustmentPct: null, property: { title: 'Casa' },
          persons: [], renewals: [], closureSummary: null,
        },
      ]),
    },
  };
  return { service: new DataQualityService({ client } as any), client };
}

describe('DataQualityService', () => {
  it('resume cada control con su cantidad y suma el total', async () => {
    const { service, client } = makeService();
    const summary = await service.summary(NOW);

    expect(summary.checks.map((c) => c.check)).toEqual(DATA_QUALITY_CHECKS.map((c) => c.id));
    const count = (id: string) => summary.checks.find((c) => c.check === id)!.count;
    expect(count('duplicate-cuit')).toBe(1);
    expect(count('duplicate-email')).toBe(1);
    expect(count('duplicate-name')).toBe(1);
    expect(count('lessors-sum')).toBe(1);
    expect(count('ownership-sum')).toBe(1);
    expect(count('owner-no-bank-account')).toBe(1);
    expect(count('contract-essentials')).toBe(1);
    expect(count('contract-expired-undecided')).toBe(0);
    expect(summary.total).toBe(summary.checks.reduce((s, c) => s + c.count, 0));
    expect(summary.generatedAt).toBe(NOW.toISOString());
    // Cada tabla se lee una sola vez por pedido aunque la usen varios controles.
    expect(client.person.findMany).toHaveBeenCalledTimes(1);
    expect(client.contract.findMany).toHaveBeenCalledTimes(1);
  });

  it('pagina los hallazgos de un control', async () => {
    const { service } = makeService();
    const page = await service.findings('duplicate-cuit', { page: '1', limit: '10' }, NOW);
    expect(page).toMatchObject({ check: 'duplicate-cuit', total: 1, page: 1, limit: 10, totalPages: 1 });
    expect(page.items[0].members).toHaveLength(2);

    const empty = await service.findings('duplicate-cuit', { page: '2', limit: '10' }, NOW);
    expect(empty.items).toEqual([]);
    expect(empty.total).toBe(1);
  });

  it('rechaza una paginación inválida', async () => {
    const { service } = makeService();
    await expect(service.findings('duplicate-cuit', { limit: '1000' }, NOW)).rejects.toBeInstanceOf(BadRequestException);
  });
});
