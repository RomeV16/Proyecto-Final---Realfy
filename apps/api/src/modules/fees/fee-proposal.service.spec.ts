import { BadRequestException, NotFoundException } from '@nestjs/common';
import { CONTRACT_ID, LESSOR_PERSON, PERIOD_ID, PROPERTY_ID, TENANT_PERSON, buildFees, d, syntheticContract } from './fees.testing';

const VALUATION_ID = 'b3b9a0f2-6a8f-4a57-9a3b-7b2a1e2e2a01';

describe('FeeProposalService', () => {
  it('alta: 5 % del total de 24 meses al inquilino, con las cuotas y el ajuste de la inmobiliaria', async () => {
    const { proposal } = buildFees();
    const p: any = await proposal.preview({ kind: 'AltaAlquiler', contractId: CONTRACT_ID });
    expect(p).toMatchObject({
      basis: 'TotalContrato',
      baseAmount: '12000000.00',
      pct: '5',
      currency: 'ARS',
      payerMode: 'Reparto',
      payerChoice: 'Inquilino',
      payers: [{ role: 'Inquilino', personId: TENANT_PERSON, name: 'Ines Inquilina', sharePct: '100' }],
      firstDueDate: '2026-03-01',
      installments: 1,
      adjustInstallments: true,
      vatMode: 'NoAplica',
      staffCommissionPct: '0',
      staffCommissionBase: 'Neto',
      contractTotal: { mode: 'ConAjustesConocidos', months: 24, projected: false, indexBased: true, initialRent: '500000' },
      estimate: ['600000.00'],
    });
  });

  it('pagan los dos según la parte del locador; con regla conocida proyecta los ajustes', async () => {
    const { proposal } = buildFees({
      defaults: { fees: { payer: 'Ambos', lessorSharePct: 40, installments: 3 } as any },
      contract: syntheticContract({
        startDate: d('2026-01-01'),
        endDate: d('2027-12-31'),
        termsVersions: [
          { validFrom: d('2026-01-01'), adjustmentType: 'FixedPercent', adjustmentPeriod: 'Semestral', customPct: '10', fixedInitialMonths: 0, adjustmentBase: 'Vigente' },
        ],
      }),
      periods: [{ id: PERIOD_ID, contractId: CONTRACT_ID, seq: 1, startDate: d('2026-01-01'), endDate: d('2027-12-31'), initialRent: '100000' }],
    });
    const p: any = await proposal.preview({ kind: 'AltaAlquiler', contractId: CONTRACT_ID });
    expect(p.baseAmount).toBe('2784600.00');
    expect(p.contractTotal.projected).toBe(true);
    expect(p.payers.map((x: any) => [x.role, x.sharePct])).toEqual([
      ['Inquilino', '60'],
      ['Locador', '40'],
    ]);
    expect(p.estimate).toEqual(['83538.00', '55692.00']);
    expect(p.installments).toBe(3);
  });

  it('paga el locador: el de mayor porcentaje', async () => {
    const { proposal } = buildFees({ defaults: { fees: { payer: 'Locador' } as any } });
    const p: any = await proposal.preview({ kind: 'AltaAlquiler', contractId: CONTRACT_ID });
    expect(p.payers).toEqual([{ role: 'Locador', personId: LESSOR_PERSON, name: 'Luis Locador', sharePct: '100' }]);
  });

  it('renovación: el período renovado, con el porcentaje de renovación', async () => {
    const renewal = { id: PERIOD_ID, contractId: CONTRACT_ID, seq: 2, startDate: d('2028-03-01'), endDate: d('2029-02-28'), initialRent: '900000' };
    const { proposal } = buildFees({ periods: [renewal] });
    const p: any = await proposal.preview({ kind: 'Renovacion', contractPeriodId: PERIOD_ID });
    expect(p).toMatchObject({ contractPeriodId: PERIOD_ID, baseAmount: '10800000.00', pct: '5', firstDueDate: '2028-03-01', estimate: ['540000.00'] });
  });

  it('renovación sin período elegido: la última renovación del contrato', async () => {
    const original = { id: 'p1', contractId: CONTRACT_ID, seq: 1, kind: 'Original', startDate: d('2026-03-01'), endDate: d('2028-02-29'), initialRent: '500000' };
    const renewal = { id: PERIOD_ID, contractId: CONTRACT_ID, seq: 2, kind: 'Renovacion', startDate: d('2028-03-01'), endDate: d('2029-02-28'), initialRent: '900000' };
    const { proposal } = buildFees({ periods: [original, renewal] });
    const p: any = await proposal.preview({ kind: 'Renovacion', contractId: CONTRACT_ID });
    expect(p).toMatchObject({ contractPeriodId: PERIOD_ID, baseAmount: '10800000.00' });
    const alta: any = await proposal.preview({ kind: 'AltaAlquiler', contractId: CONTRACT_ID });
    expect(alta).toMatchObject({ contractPeriodId: null, baseAmount: '12000000.00' });
  });

  it('venta: cada parte, porcentaje según construido o lote', async () => {
    const built = await buildFees().proposal.preview({ kind: 'Venta', propertyId: PROPERTY_ID, baseAmount: '120000' });
    expect(built).toMatchObject({ basis: 'ValorOperacion', saleAsset: 'Construido', pct: '3', currency: 'USD', payerMode: 'CadaParte', estimate: ['3600.00'] });
    const lot = await buildFees({ property: { id: PROPERTY_ID, type: 'Lote' } }).proposal.preview({ kind: 'Venta', propertyId: PROPERTY_ID });
    expect(lot).toMatchObject({ saleAsset: 'Lote', pct: '5', baseAmount: '0' });
    const forced = await buildFees().proposal.preview({ kind: 'Venta', saleAsset: 'Lote', currency: 'ARS', baseAmount: '1000' });
    expect(forced).toMatchObject({ pct: '5', currency: 'ARS', propertyId: null });
  });

  it('tasación: USD 100 al titular de la propiedad tasada; gestión de reparación en cero', async () => {
    const { proposal } = buildFees({
      valuation: { id: VALUATION_ID, propertyId: PROPERTY_ID },
      owners: [{ personId: LESSOR_PERSON, person: { firstName: 'Luis', lastName: 'Locador' } }],
    });
    const p: any = await proposal.preview({ kind: 'Tasacion', valuationId: VALUATION_ID });
    expect(p).toMatchObject({
      basis: 'MontoFijo',
      baseAmount: '100',
      pct: null,
      currency: 'USD',
      propertyId: PROPERTY_ID,
      payers: [{ role: 'Otro', personId: LESSOR_PERSON, name: 'Luis Locador', sharePct: '100' }],
      estimate: ['100.00'],
    });
    const repair: any = await buildFees().proposal.preview({ kind: 'GestionReparacion' });
    expect(repair).toMatchObject({ baseAmount: '0', currency: 'ARS', payers: [], propertyId: null });
  });

  it.each([
    ['alquiler sin contrato', { kind: 'AltaAlquiler' }, BadRequestException],
    ['contrato inexistente', { kind: 'AltaAlquiler', contractId: '99999999-9999-4999-8999-999999999999' }, NotFoundException],
    ['período inexistente', { kind: 'Renovacion', contractPeriodId: '99999999-9999-4999-8999-999999999999' }, NotFoundException],
    ['propiedad inexistente', { kind: 'Venta', propertyId: '99999999-9999-4999-8999-999999999999' }, NotFoundException],
    ['tasación inexistente', { kind: 'Tasacion', valuationId: VALUATION_ID }, NotFoundException],
  ])('rechaza: %s', async (_label, query, error) => {
    await expect(buildFees().proposal.preview(query)).rejects.toBeInstanceOf(error);
  });

  it('un plazo invertido es un 400 del motor', async () => {
    const { proposal } = buildFees({
      periods: [{ id: PERIOD_ID, contractId: CONTRACT_ID, seq: 1, startDate: d('2027-01-01'), endDate: d('2026-01-01'), initialRent: '1' }],
    });
    await expect(proposal.preview({ kind: 'AltaAlquiler', contractId: CONTRACT_ID })).rejects.toMatchObject({ response: { error: 'INVALID_TERM' } });
  });

  it('sin períodos usa las fechas y el alquiler del contrato', async () => {
    const { proposal } = buildFees({ periods: [] });
    const p: any = await proposal.preview({ kind: 'AltaAlquiler', contractId: CONTRACT_ID });
    expect(p.contractTotal).toMatchObject({ start: '2026-03-01', end: '2028-02-29', initialRent: '500000' });
  });
});
