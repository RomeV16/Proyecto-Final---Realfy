import { LessorInvoiceScope, LessorInvoiceWhen } from '@realfy/shared';
import { LessorInvoicingService } from './lessor-invoicing.service';

const PERSON = { id: 'p-1', firstName: 'Ana', lastName: 'Locadora', cuit: '20-12345678-6', dni: null, fiscalCondition: 'Monotributista' };
const TENANT_PERSON = { id: 'p-2', firstName: 'Beto', lastName: 'Inquilino', cuit: '20-30000000-1', dni: '30000000', fiscalCondition: 'ConsumidorFinal' };
const ISSUER = {
  id: 'i-1',
  tenantId: 't-1',
  personId: 'p-1',
  cuit: '20123456786',
  businessName: 'Ana Locadora',
  fiscalCondition: 'Monotributista',
  delegationStatus: 'Active',
  isActive: true,
  invoicingSettings: null,
  createdAt: new Date('2026-01-01T00:00:00Z'),
  puntosDeVenta: [],
};
const DEFAULTS = { invoicing: { scope: 'Alquiler', when: 'Manual', vatPct: 0 } };

function build(overrides: { defaults?: any } = {}) {
  const client: any = {
    person: { findFirst: jest.fn(async () => PERSON) },
    arcaIssuer: {
      findFirst: jest.fn(async () => ISSUER),
      findMany: jest.fn(async () => []),
      update: jest.fn(async (a: any) => ({ ...ISSUER, ...a.data })),
    },
    payment: {
      findFirst: jest.fn(async () => ({ id: 'pay-1', liquidacion: { period: new Date('2026-10-01T00:00:00Z') } })),
    },
    ownerStatement: {
      findFirst: jest.fn(async () => ({ id: 'st-1', personId: 'p-1', status: 'Emitido', period: new Date('2026-10-01T00:00:00Z') })),
      findMany: jest.fn(async () => []),
    },
    ownerLedgerEntry: {
      findMany: jest.fn(async () => [
        { personId: 'p-1', contractId: 'c-1', type: 'Alquiler', amount: '100000.00', currency: 'ARS', sourceId: 'pay-1' },
      ]),
    },
    contract: {
      findFirst: jest.fn(async () => ({
        id: 'c-1',
        property: { title: 'Depto 3B' },
        persons: [{ id: 'cp-1', role: 'Inquilino', person: TENANT_PERSON }],
      })),
    },
    comprobante: { findMany: jest.fn(async () => []) },
    lessorInvoiceJob: {
      findUnique: jest.fn(async () => null),
      findFirst: jest.fn(),
      findMany: jest.fn(async () => []),
      create: jest.fn(async (a: any) => ({ id: 'j-1', status: 'Pendiente', attempts: 0, updatedAt: new Date(), ...a.data })),
      createMany: jest.fn(async (a: any) => ({ count: a.data.length })),
      updateMany: jest.fn(async () => ({ count: 1 })),
      update: jest.fn(async (a: any) => ({ id: a.where.id, personId: 'p-1', sourceType: 'Payment', sourceId: 'pay-1', kind: 'Factura', ...a.data })),
      count: jest.fn(async () => 0),
    },
  };
  const prisma = { client };
  const tenantContext = { getTenantId: () => 't-1' };
  const invoices = {
    resolvePuntoDeVenta: jest.fn(async () => 3),
    emitFromDto: jest.fn(async (..._a: any[]) => ({ comprobante: { id: 'cmp-1' }, isIdempotentReplay: false })),
    voidComprobante: jest.fn(async (..._a: any[]) => ({ id: 'nc-1' })),
  };
  const issuers = { createIssuer: jest.fn(async (d: any, personId: string) => ({ id: 'i-new', ...d, personId })) };
  const operationalDefaults = { get: jest.fn(async () => overrides.defaults ?? DEFAULTS) };
  const audit = { record: jest.fn(async () => undefined) };
  const service = new LessorInvoicingService(
    prisma as any,
    tenantContext as any,
    invoices as any,
    issuers as any,
    operationalDefaults as any,
    audit as any,
  );
  return { service, client, invoices, issuers, audit, operationalDefaults };
}

const pendingJob = (over: any = {}) => ({
  id: 'j-1',
  tenantId: 't-1',
  personId: 'p-1',
  sourceType: 'Payment',
  sourceId: 'pay-1',
  kind: 'Factura',
  status: 'Pendiente',
  auto: false,
  attempts: 0,
  updatedAt: new Date('2026-11-01T00:00:00Z'),
  ...over,
});

describe('LessorInvoicingService — emisor delegado y configuración', () => {
  it('muestra el emisor, lo que definió el locador y lo que rige', async () => {
    const { service, client } = build();
    client.arcaIssuer.findFirst.mockResolvedValue({
      ...ISSUER,
      invoicingSettings: { scope: 'AlquilerPunitorios', autoSince: '2026-10-01T00:00:00.000Z' },
    });
    const result = await service.getSettings('p-1');
    expect(result.issuer?.cuit).toBe('20123456786');
    expect(result.override).toEqual({ scope: 'AlquilerPunitorios', when: undefined, vatPct: undefined });
    expect(result.effective).toEqual({ scope: 'AlquilerPunitorios', when: 'Manual', vatPct: 0 });
    expect(result.autoSince).toBe('2026-10-01T00:00:00.000Z');
  });

  it('sin emisor devuelve issuer nulo y los valores de la inmobiliaria', async () => {
    const { service, client } = build();
    client.arcaIssuer.findFirst.mockResolvedValue(null);
    const result = await service.getSettings('p-1');
    expect(result.issuer).toBeNull();
    expect(result.override).toBeNull();
    expect(result.effective).toEqual(DEFAULTS.invoicing);
  });

  it('crea el emisor con el CUIT y la condición de la persona, nunca como propio', async () => {
    const { service, client, issuers } = build();
    client.arcaIssuer.findFirst.mockResolvedValue(null);
    await service.createIssuer('p-1', { businessAddress: 'Calle 1' });
    expect(issuers.createIssuer).toHaveBeenCalledWith(
      expect.objectContaining({ cuit: '20-12345678-6', businessName: 'Ana Locadora', fiscalCondition: 'Monotributista', businessAddress: 'Calle 1' }),
      'p-1',
    );
  });

  it.each([
    ['PERSON_CUIT_REQUIRED', { cuit: null }],
    ['PERSON_FISCAL_CONDITION_REQUIRED', { fiscalCondition: null }],
    ['FISCAL_CONDITION_CANNOT_INVOICE', { fiscalCondition: 'ConsumidorFinal' }],
  ])('rechaza el alta sin %s', async (code, patch) => {
    const { service, client } = build();
    client.person.findFirst.mockResolvedValue({ ...PERSON, ...patch });
    await expect(service.createIssuer('p-1', {})).rejects.toMatchObject({ response: { error: code } });
  });

  it('rechaza un segundo emisor y reactiva uno dado de baja', async () => {
    const { service, client, issuers } = build();
    await expect(service.createIssuer('p-1', {})).rejects.toMatchObject({ response: { error: 'LESSOR_ISSUER_EXISTS' } });
    client.arcaIssuer.findFirst.mockResolvedValue({ ...ISSUER, isActive: false });
    await service.createIssuer('p-1', {});
    expect(client.arcaIssuer.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ isActive: true, delegationStatus: 'Pending' }) }),
    );
    expect(issuers.createIssuer).not.toHaveBeenCalled();
  });

  it('guarda la configuración y deja constancia de desde cuándo factura solo', async () => {
    const { service, client, audit } = build();
    await service.saveSettings('p-1', { when: LessorInvoiceWhen.AlPagar, scope: LessorInvoiceScope.TodoLocador, vatPct: 21 });
    const data = client.arcaIssuer.update.mock.calls[0][0].data.invoicingSettings;
    expect(data).toMatchObject({ when: 'AlPagar', scope: 'TodoLocador', vatPct: 21 });
    expect(new Date(data.autoSince).getTime()).toBeLessThanOrEqual(Date.now());
    expect(audit.record).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ entity: 'ArcaIssuer' }));
  });

  it('no mueve autoSince si ya facturaba solo, y vaciar la configuración la borra', async () => {
    const { service, client } = build();
    client.arcaIssuer.findFirst.mockResolvedValue({
      ...ISSUER,
      invoicingSettings: { when: 'AlPagar', autoSince: '2026-10-05T00:00:00.000Z' },
    });
    await service.saveSettings('p-1', { when: 'AlPagar', scope: 'Alquiler' });
    expect(client.arcaIssuer.update.mock.calls[0][0].data.invoicingSettings.autoSince).toBe('2026-10-05T00:00:00.000Z');
    await service.saveSettings('p-1', { when: null, scope: null, vatPct: null });
    expect(client.arcaIssuer.update.mock.calls[1][0].data.invoicingSettings).toBeNull();
  });

  it('exige el emisor antes de guardar y valida la alícuota', async () => {
    const { service, client } = build();
    await expect(service.saveSettings('p-1', { vatPct: 13 })).rejects.toBeDefined();
    client.arcaIssuer.findFirst.mockResolvedValue(null);
    await expect(service.saveSettings('p-1', {})).rejects.toMatchObject({ response: { error: 'LESSOR_ISSUER_REQUIRED' } });
  });

  it('una persona inexistente es 404', async () => {
    const { service, client } = build();
    client.person.findFirst.mockResolvedValue(null);
    await expect(service.getSettings('x')).rejects.toMatchObject({ response: { error: 'PERSON_NOT_FOUND' } });
  });
});

describe('LessorInvoicingService — emisión', () => {
  it('emite la factura del locador al inquilino con el importe exacto y una clave de idempotencia estable', async () => {
    const { service, client, invoices, audit } = build();
    client.lessorInvoiceJob.findFirst.mockResolvedValue(pendingJob());
    const result = await service.process('j-1', false);
    expect(result).toMatchObject({ status: 'Emitido', comprobanteIds: ['cmp-1'] });
    const dto = invoices.emitFromDto.mock.calls[0][0];
    // Monotributista -> Factura C a cualquier receptor, sin IVA discriminado.
    expect(dto).toMatchObject({
      issuerId: 'i-1',
      ptoVta: 3,
      cbteTipo: 11,
      impTotal: '100000.00',
      impNeto: '100000.00',
      impIVA: '0.00',
      paymentId: 'pay-1',
      fchServDesde: '2026-10-01',
      fchServHasta: '2026-10-31',
      receptor: { docTipo: 80, docNro: '20300000001', businessName: 'Beto Inquilino', condicionIVAReceptorId: 5 },
    });
    expect(dto.iva).toBeUndefined();
    expect(dto.clientRequestId).toMatch(/^[0-9a-f-]{36}$/);
    expect(audit.record).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ metadata: expect.objectContaining({ operation: 'lessor-invoice-emit' }) }));
    // Mismo trabajo, misma clave.
    client.lessorInvoiceJob.findFirst.mockResolvedValue(pendingJob());
    await service.process('j-1', false);
    expect(invoices.emitFromDto.mock.calls[1][0].clientRequestId).toBe(dto.clientRequestId);
  });

  it('un responsable inscripto factura A al receptor con CUIT y discrimina el IVA configurado', async () => {
    const { service, client, invoices } = build({ defaults: { invoicing: { scope: 'Alquiler', when: 'Manual', vatPct: 21 } } });
    client.arcaIssuer.findFirst.mockResolvedValue({ ...ISSUER, fiscalCondition: 'ResponsableInscripto' });
    client.contract.findFirst.mockResolvedValue({
      id: 'c-1',
      property: null,
      persons: [{ id: 'cp-1', role: 'Inquilino', person: { ...TENANT_PERSON, fiscalCondition: 'ResponsableInscripto' } }],
    });
    client.ownerLedgerEntry.findMany.mockResolvedValue([
      { contractId: 'c-1', type: 'Alquiler', amount: '121000.00', currency: 'ARS' },
    ]);
    client.lessorInvoiceJob.findFirst.mockResolvedValue(pendingJob());
    await service.process('j-1', false);
    const dto = invoices.emitFromDto.mock.calls[0][0];
    expect(dto).toMatchObject({ cbteTipo: 1, impTotal: '121000.00', impNeto: '100000.00', impIVA: '21000.00' });
    expect(dto.iva).toEqual([{ id: 5, baseImp: '100000.00', importe: '21000.00' }]);
  });

  it('el alcance decide qué conceptos entran y emite una factura por contrato', async () => {
    const { service, client, invoices } = build({ defaults: { invoicing: { scope: 'AlquilerPunitorios', when: 'Manual', vatPct: 0 } } });
    client.ownerLedgerEntry.findMany.mockResolvedValue([
      { contractId: 'c-2', type: 'Alquiler', amount: '50.00', currency: 'ARS' },
      { contractId: 'c-1', type: 'Alquiler', amount: '100.00', currency: 'ARS' },
      { contractId: 'c-1', type: 'Punitorio', amount: '5.50', currency: 'ARS' },
    ]);
    client.lessorInvoiceJob.findFirst.mockResolvedValue(pendingJob());
    await service.process('j-1', false);
    const where = client.ownerLedgerEntry.findMany.mock.calls[0][0].where;
    expect(where.type.in).toEqual(['Alquiler', 'Punitorio']);
    expect(invoices.emitFromDto.mock.calls.map((c: any[]) => c[0].impTotal)).toEqual(['105.50', '50.00']);
  });

  it('un estado de cuenta emitido se factura por sus asientos y ata el comprobante al estado', async () => {
    const { service, client, invoices } = build();
    client.lessorInvoiceJob.findFirst.mockResolvedValue(pendingJob({ sourceType: 'OwnerStatement', sourceId: 'st-1' }));
    await service.process('j-1', false);
    expect(client.ownerLedgerEntry.findMany.mock.calls[0][0].where).toMatchObject({ statementId: 'st-1' });
    expect(invoices.emitFromDto.mock.calls[0][0]).toMatchObject({ ownerStatementId: 'st-1' });
    expect(invoices.emitFromDto.mock.calls[0][0].paymentId).toBeUndefined();
  });

  it('sin importe en el alcance queda omitido, sin emitir', async () => {
    const { service, client, invoices } = build();
    client.ownerLedgerEntry.findMany.mockResolvedValue([]);
    client.lessorInvoiceJob.findFirst.mockResolvedValue(pendingJob());
    const result = await service.process('j-1', false);
    expect(result.status).toBe('Omitido');
    expect(invoices.emitFromDto).not.toHaveBeenCalled();
  });

  it.each([
    ['CURRENCY_NOT_SUPPORTED', (c: any) => c.ownerLedgerEntry.findMany.mockResolvedValue([{ contractId: 'c-1', type: 'Alquiler', amount: '10', currency: 'USD' }])],
    ['NO_CONTRACT', (c: any) => c.ownerLedgerEntry.findMany.mockResolvedValue([{ contractId: null, type: 'Alquiler', amount: '10', currency: 'ARS' }])],
    ['TENANT_PARTY_REQUIRED', (c: any) => c.contract.findFirst.mockResolvedValue({ id: 'c-1', persons: [] })],
    ['CONTRACT_NOT_FOUND', (c: any) => c.contract.findFirst.mockResolvedValue(null)],
    ['LESSOR_ISSUER_REQUIRED', (c: any) => c.arcaIssuer.findFirst.mockResolvedValue(null)],
    ['PAYMENT_NOT_FOUND', (c: any) => c.payment.findFirst.mockResolvedValue(null)],
  ])('un fallo %s deja el trabajo Fallido con el motivo', async (code, arrange) => {
    const { service, client, invoices } = build();
    arrange(client);
    client.lessorInvoiceJob.findFirst.mockResolvedValue(pendingJob());
    const result = await service.process('j-1', false);
    expect(result.status).toBe('Fallido');
    expect(result.error).toContain(code);
    expect(invoices.emitFromDto).not.toHaveBeenCalled();
  });

  it('una factura A exige el CUIT del receptor y un emisor que no factura se rechaza', async () => {
    const { service, client } = build();
    client.arcaIssuer.findFirst.mockResolvedValue({ ...ISSUER, fiscalCondition: 'ResponsableInscripto' });
    client.contract.findFirst.mockResolvedValue({
      id: 'c-1',
      persons: [{ id: 'cp-1', role: 'Inquilino', person: { ...TENANT_PERSON, cuit: null, dni: null, fiscalCondition: 'ResponsableInscripto' } }],
    });
    client.lessorInvoiceJob.findFirst.mockResolvedValue(pendingJob());
    expect((await service.process('j-1', false)).error).toContain('RECEPTOR_CUIT_REQUIRED');
    client.arcaIssuer.findFirst.mockResolvedValue({ ...ISSUER, fiscalCondition: 'ConsumidorFinal' });
    client.lessorInvoiceJob.findFirst.mockResolvedValue(pendingJob());
    expect((await service.process('j-1', false)).error).toContain('FISCAL_CONDITION_CANNOT_INVOICE');
  });

  it('un receptor con DNI o sin documento se factura con su documento', async () => {
    const { service, client, invoices } = build();
    client.contract.findFirst.mockResolvedValue({
      id: 'c-1',
      persons: [{ id: 'cp-1', role: 'Inquilino', person: { ...TENANT_PERSON, cuit: null } }],
    });
    client.lessorInvoiceJob.findFirst.mockResolvedValue(pendingJob());
    await service.process('j-1', false);
    expect(invoices.emitFromDto.mock.calls[0][0].receptor).toMatchObject({ docTipo: 96, docNro: '30000000' });
    client.contract.findFirst.mockResolvedValue({
      id: 'c-1',
      persons: [{ id: 'cp-1', role: 'Inquilino', person: { ...TENANT_PERSON, cuit: null, dni: null, fiscalCondition: null } }],
    });
    client.lessorInvoiceJob.findFirst.mockResolvedValue(pendingJob());
    await service.process('j-1', false);
    expect(invoices.emitFromDto.mock.calls[1][0].receptor).toMatchObject({ docTipo: 99, docNro: '0', fiscalCondition: 'ConsumidorFinal' });
  });

  it('un error de ARCA se guarda en el trabajo y no se pierde', async () => {
    const { service, client, invoices } = build();
    invoices.emitFromDto.mockRejectedValue({ getResponse: () => ({ errorCode: '10016', message: 'Rechazado' }) });
    client.lessorInvoiceJob.findFirst.mockResolvedValue(pendingJob());
    const result = await service.process('j-1', false);
    expect(result).toMatchObject({ status: 'Fallido', error: '10016: Rechazado' });
    expect(client.lessorInvoiceJob.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: { status: 'Fallido', lastError: '10016: Rechazado' } }),
    );
  });

  it('si otro proceso reclamó el trabajo antes, no emite', async () => {
    const { service, client, invoices } = build();
    client.lessorInvoiceJob.findFirst.mockResolvedValue(pendingJob());
    client.lessorInvoiceJob.updateMany.mockResolvedValue({ count: 0 });
    const result = await service.process('j-1', false);
    expect(result.status).toBe('Pendiente');
    expect(invoices.emitFromDto).not.toHaveBeenCalled();
  });

  it('un trabajo ya emitido no se vuelve a emitir y puede devolver sus comprobantes', async () => {
    const { service, client, invoices } = build();
    client.lessorInvoiceJob.findFirst.mockResolvedValue(pendingJob({ status: 'Emitido' }));
    client.comprobante.findMany.mockResolvedValue([{ id: 'cmp-9' }]);
    expect(await service.process('j-1', true)).toMatchObject({ status: 'Emitido', comprobanteIds: ['cmp-9'] });
    expect((await service.process('j-1', false)).comprobanteIds).toEqual([]);
    expect(invoices.emitFromDto).not.toHaveBeenCalled();
    client.lessorInvoiceJob.findFirst.mockResolvedValue(null);
    await expect(service.process('x', false)).rejects.toMatchObject({ response: { error: 'JOB_NOT_FOUND' } });
  });

  it('emite la nota de crédito de cada factura del origen que no tiene una', async () => {
    const { service, client, invoices } = build();
    client.lessorInvoiceJob.findFirst.mockResolvedValue(pendingJob({ kind: 'NotaCredito', sourceType: 'OwnerStatement', sourceId: 'st-1' }));
    client.comprobante.findMany.mockResolvedValue([
      { id: 'cmp-1', creditNotes: [] },
      { id: 'cmp-2', creditNotes: [{ id: 'nc-old' }] },
    ]);
    const result = await service.process('j-1', false);
    expect(result).toMatchObject({ status: 'Emitido', comprobanteIds: ['nc-1', 'nc-old'] });
    expect(invoices.voidComprobante).toHaveBeenCalledTimes(1);
    expect(invoices.voidComprobante).toHaveBeenCalledWith('cmp-1', { clientRequestId: expect.stringMatching(/^[0-9a-f-]{36}$/) });
  });

  it('sin facturas que anular, la nota de crédito queda omitida', async () => {
    const { service, client } = build();
    client.lessorInvoiceJob.findFirst.mockResolvedValue(pendingJob({ kind: 'NotaCredito' }));
    expect((await service.process('j-1', false)).status).toBe('Omitido');
  });
});

describe('LessorInvoicingService — emisión manual', () => {
  it('factura un cobro por cuenta de cada locador con emisor delegado y devuelve los resultados', async () => {
    const { service, client } = build();
    client.ownerLedgerEntry.findMany.mockResolvedValueOnce([{ personId: 'p-1' }, { personId: 'p-1' }, { personId: 'p-9' }]);
    client.arcaIssuer.findFirst.mockImplementation(async (a: any) => (a.where.personId === 'p-9' ? null : ISSUER));
    client.lessorInvoiceJob.findFirst.mockResolvedValue(pendingJob());
    const out = await service.invoicePayment('pay-1');
    expect(out.results).toHaveLength(1);
    expect(out.results[0]).toMatchObject({ personId: 'p-1', status: 'Emitido' });
  });

  it('con un locador indicado sin emisor, es 409', async () => {
    const { service, client } = build();
    client.arcaIssuer.findFirst.mockResolvedValue(null);
    await expect(service.invoicePayment('pay-1', { personId: 'p-1' })).rejects.toMatchObject({ response: { error: 'LESSOR_ISSUER_REQUIRED' } });
  });

  it('un cobro inexistente es 404', async () => {
    const { service, client } = build();
    client.payment.findFirst.mockResolvedValue(null);
    await expect(service.invoicePayment('x')).rejects.toMatchObject({ response: { error: 'PAYMENT_NOT_FOUND' } });
  });

  it('un fallo al emitir responde 422 con el motivo y los resultados', async () => {
    const { service, client, invoices } = build();
    invoices.emitFromDto.mockRejectedValue(new Error('ARCA caído'));
    client.lessorInvoiceJob.findFirst.mockResolvedValue(pendingJob());
    await expect(service.invoicePayment('pay-1', { personId: 'p-1' })).rejects.toMatchObject({
      response: { error: 'LESSOR_INVOICE_FAILED', message: 'ARCA caído' },
    });
  });

  it('no factura por la vía que el locador no tiene configurada', async () => {
    const { service, client } = build();
    client.arcaIssuer.findFirst.mockResolvedValue({ ...ISSUER, invoicingSettings: { when: 'AlEmitirEstado' } });
    await expect(service.invoicePayment('pay-1', { personId: 'p-1' })).rejects.toMatchObject({
      response: { error: 'INVOICING_TRIGGER_MISMATCH' },
    });
    client.arcaIssuer.findFirst.mockResolvedValue({ ...ISSUER, invoicingSettings: { when: 'AlPagar' } });
    await expect(service.invoiceStatement('st-1')).rejects.toMatchObject({ response: { error: 'INVOICING_TRIGGER_MISMATCH' } });
  });

  it('un estado se factura solo si está emitido', async () => {
    const { service, client } = build();
    client.ownerStatement.findFirst.mockResolvedValue({ id: 'st-1', personId: 'p-1', status: 'Borrador' });
    await expect(service.invoiceStatement('st-1')).rejects.toMatchObject({ response: { error: 'STATEMENT_NOT_ISSUED' } });
    client.ownerStatement.findFirst.mockResolvedValue(null);
    await expect(service.invoiceStatement('st-1')).rejects.toMatchObject({ response: { error: 'STATEMENT_NOT_FOUND' } });
  });

  it('factura un estado emitido por cuenta de su locador', async () => {
    const { service, client } = build();
    client.lessorInvoiceJob.findFirst.mockResolvedValue(pendingJob({ sourceType: 'OwnerStatement', sourceId: 'st-1' }));
    const out = await service.invoiceStatement('st-1');
    expect(out.results[0]).toMatchObject({ status: 'Emitido' });
  });

  it('un estado de cuenta emitido en el que falta el estado al procesar es 409', async () => {
    const { service, client } = build();
    client.ownerStatement.findFirst.mockResolvedValue({ id: 'st-1', status: 'Anulado', period: new Date() });
    client.lessorInvoiceJob.findFirst.mockResolvedValue(pendingJob({ sourceType: 'OwnerStatement', sourceId: 'st-1' }));
    expect((await service.process('j-1', false)).error).toContain('STATEMENT_NOT_ISSUED');
    client.ownerStatement.findFirst.mockResolvedValue(null);
    client.lessorInvoiceJob.findFirst.mockResolvedValue(pendingJob({ sourceType: 'OwnerStatement', sourceId: 'st-1' }));
    expect((await service.process('j-1', false)).error).toContain('STATEMENT_NOT_FOUND');
  });

  it('si el trabajo ya existe lo reutiliza; si lo crean a la vez, toma el creado', async () => {
    const { service, client } = build();
    client.lessorInvoiceJob.findUnique.mockResolvedValueOnce(pendingJob({ id: 'j-exist' }));
    client.lessorInvoiceJob.findFirst.mockResolvedValue(pendingJob({ id: 'j-exist' }));
    await service.invoicePayment('pay-1', { personId: 'p-1' });
    expect(client.lessorInvoiceJob.create).not.toHaveBeenCalled();
    client.lessorInvoiceJob.findUnique.mockResolvedValueOnce(null).mockResolvedValueOnce(pendingJob({ id: 'j-race' }));
    client.lessorInvoiceJob.create.mockRejectedValueOnce(new Error('unique'));
    client.lessorInvoiceJob.findFirst.mockResolvedValue(pendingJob({ id: 'j-race' }));
    const out = await service.invoicePayment('pay-1', { personId: 'p-1' });
    expect(out.results[0].jobId).toBe('j-race');
    client.lessorInvoiceJob.findUnique.mockResolvedValueOnce(null).mockResolvedValueOnce(null);
    client.lessorInvoiceJob.create.mockRejectedValueOnce(new Error('boom'));
    await expect(service.invoicePayment('pay-1', { personId: 'p-1' })).rejects.toThrow('boom');
  });

  it('lista comprobantes y trabajos de un cobro y de un estado', async () => {
    const { service, client } = build();
    await service.listForSource('Payment', 'pay-1');
    expect(client.comprobante.findMany.mock.calls[0][0].where).toEqual({ paymentId: 'pay-1' });
    await service.listForSource('OwnerStatement', 'st-1');
    expect(client.comprobante.findMany.mock.calls[1][0].where).toEqual({ ownerStatementId: 'st-1' });
  });
});

describe('LessorInvoicingService — cola y facturación automática', () => {
  it('pone en cola los cobros nuevos del alcance de los locadores en AlPagar, desde que lo activaron', async () => {
    const { service, client } = build({ defaults: { invoicing: { scope: 'Alquiler', when: 'AlPagar', vatPct: 0 } } });
    const recent = new Date(Date.now() - 5 * 86_400_000).toISOString();
    client.arcaIssuer.findMany.mockResolvedValue([{ ...ISSUER, invoicingSettings: { autoSince: recent } }]);
    client.ownerLedgerEntry.findMany.mockResolvedValue([{ sourceId: 'pay-1' }, { sourceId: 'pay-1' }, { sourceId: 'pay-2' }]);
    expect(await service.enqueueAuto()).toBe(2);
    const where = client.ownerLedgerEntry.findMany.mock.calls[0][0].where;
    expect(where.type.in).toEqual(['Alquiler']);
    expect(where.createdAt.gte.toISOString()).toBe(recent);
    expect(client.lessorInvoiceJob.createMany.mock.calls[0][0]).toMatchObject({ skipDuplicates: true });
  });

  it('por estado de cuenta toma los emitidos; manual no pone nada en cola', async () => {
    const { service, client } = build({ defaults: { invoicing: { scope: 'Alquiler', when: 'AlEmitirEstado', vatPct: 0 } } });
    client.arcaIssuer.findMany.mockResolvedValue([ISSUER]);
    client.ownerStatement.findMany.mockResolvedValue([{ id: 'st-1' }]);
    expect(await service.enqueueAuto()).toBe(1);
    expect(client.ownerStatement.findMany.mock.calls[0][0].where.status).toEqual({ in: ['Emitido', 'Enviado'] });
    const manual = build();
    manual.client.arcaIssuer.findMany.mockResolvedValue([ISSUER]);
    expect(await manual.service.enqueueAuto()).toBe(0);
    expect(manual.client.lessorInvoiceJob.createMany).not.toHaveBeenCalled();
  });

  it('sin cobros nuevos no escribe', async () => {
    const { service, client } = build({ defaults: { invoicing: { scope: 'Alquiler', when: 'AlPagar', vatPct: 0 } } });
    client.arcaIssuer.findMany.mockResolvedValue([ISSUER]);
    client.ownerLedgerEntry.findMany.mockResolvedValue([]);
    expect(await service.enqueueAuto()).toBe(0);
  });

  it('no mira más atrás que el tope aunque la configuración sea vieja', async () => {
    const { service, client } = build({ defaults: { invoicing: { scope: 'Alquiler', when: 'AlPagar', vatPct: 0 } } });
    client.arcaIssuer.findMany.mockResolvedValue([ISSUER]);
    client.ownerLedgerEntry.findMany.mockResolvedValue([]);
    await service.enqueueAuto();
    const gte = client.ownerLedgerEntry.findMany.mock.calls[0][0].where.createdAt.gte as Date;
    expect(Date.now() - gte.getTime()).toBeLessThan(61 * 86_400_000);
  });

  it('runPending emite lo pendiente y resume; los que agotaron intentos solo con retryAll', async () => {
    const { service, client } = build();
    client.lessorInvoiceJob.findMany.mockResolvedValue([{ id: 'j-1' }, { id: 'j-2' }]);
    client.lessorInvoiceJob.findFirst
      .mockResolvedValueOnce(pendingJob({ id: 'j-1' }))
      .mockResolvedValueOnce(pendingJob({ id: 'j-2', personId: 'p-1' }));
    client.ownerLedgerEntry.findMany.mockResolvedValue([]);
    const summary = await service.runPending();
    expect(summary).toMatchObject({ processed: 2, emitted: 0, skipped: 2, failed: 0, enqueued: 0 });
    expect(client.lessorInvoiceJob.findMany.mock.calls[0][0].where.attempts).toEqual({ lt: 5 });
    await service.runPending({ retryAll: true, personId: 'p-1' });
    const where = client.lessorInvoiceJob.findMany.mock.calls[1][0].where;
    expect(where.attempts).toBeUndefined();
    expect(where.personId).toBe('p-1');
  });

  it('lista la cola: por defecto pendientes y fallidos', async () => {
    const { service, client } = build();
    client.lessorInvoiceJob.count.mockResolvedValue(45);
    const page = await service.listJobs({ page: '2', limit: '20' });
    expect(client.lessorInvoiceJob.findMany.mock.calls[0][0]).toMatchObject({
      where: { tenantId: 't-1', status: { in: ['Pendiente', 'Fallido'] } },
      skip: 20,
      take: 20,
    });
    expect(page.totalPages).toBe(3);
    await service.listJobs({ status: 'Emitido', personId: '9b2a1f0c-0d8e-4c3b-8a55-0f6d6f3a1c11' });
    expect(client.lessorInvoiceJob.findMany.mock.calls[1][0].where).toMatchObject({ status: 'Emitido' });
  });
});
