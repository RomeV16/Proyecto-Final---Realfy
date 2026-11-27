import { describe, expect, it } from 'vitest';
import type { SheetRow } from '@/lib/service-bills';
import { groupByServiceType, hasBill } from './service-board';

const row = (id: string, serviceType: string, statuses: string[] = []): SheetRow => ({
  service: {
    id,
    serviceType,
    providerName: null,
    amount: '0',
    currency: 'ARS',
    dueDay: 10,
    billingFrequency: 'Mensual',
    hasAnnualOption: false,
    property: { id: `p-${id}`, title: id },
  },
  bills: statuses.map((status, i) => ({
    id: `${id}-${i}`,
    installmentLabel: '11/2026',
    amount: '100',
    dueDate: null,
    consumption: null,
    status,
    paidBy: null,
  })),
  rules: [],
});

describe('tablero de boletas', () => {
  it('una boleta anulada no cuenta como cargada', () => {
    expect(hasBill(row('a', 'Gas'))).toBe(false);
    expect(hasBill(row('a', 'Gas', ['Anulada']))).toBe(false);
    expect(hasBill(row('a', 'Gas', ['Anulada', 'Pendiente']))).toBe(true);
    expect(hasBill(row('a', 'Gas', ['Pagada']))).toBe(true);
  });

  it('agrupa por tipo de servicio en el orden de llegada y cuenta las cargadas', () => {
    const groups = groupByServiceType([
      row('a', 'Gas', ['Pendiente']),
      row('b', 'Agua'),
      row('c', 'Gas'),
      row('d', 'Gas', ['Anulada']),
    ]);
    expect(groups.map((g) => [g.serviceType, g.rows.length, g.loaded])).toEqual([
      ['Gas', 3, 1],
      ['Agua', 1, 0],
    ]);
  });
});
