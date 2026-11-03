import { CollectionActionKind as K, CollectionActionStatus, CollectionStage as S } from '@realfy/shared';
import { overduePeriods, formatDebtAmount } from './collection-debt.service';
import { day, makeFakeCollections, type FakeLiquidacion } from './collections.testing';

const MARCH: FakeLiquidacion = { id: 'liq-mar', period: day('2026-03-01'), dueDate: day('2026-03-10'), total: '100000.00' };
const APRIL: FakeLiquidacion = { id: 'liq-apr', period: day('2026-04-01'), dueDate: day('2026-04-10'), total: '100000.00' };

/** Los servicios leen `todayInAR()`: se fija el reloj en un día de marzo de 2026 (mediodía en Buenos Aires). */
function at(iso: string) {
  jest.useFakeTimers({ now: new Date(`${iso}T15:00:00.000Z`) });
}

afterEach(() => jest.useRealTimers());

const LETTER = {
  recipientName: 'Ana Prueba',
  recipientAddress: 'Calle Falsa 123',
  propertyAddress: 'Calle Demo 742',
  periods: '03/2026',
  amount: 'ARS 100.000,00',
  issuedOn: '11/04/2026',
  termDays: 10,
  extraText: '',
};

describe('CollectionsService', () => {
  describe('lectura', () => {
    it('lista los casos abiertos con lo que se debe hoy, del más viejo al más nuevo', async () => {
      at('2026-03-20');
      const f = makeFakeCollections({
        liquidaciones: [MARCH, { ...APRIL, id: 'liq-b', contractId: 'contract-2', dueDate: day('2026-03-14') }],
        cases: [
          { id: 'c-1', contractId: 'contract-1', overdueSince: day('2026-03-10') },
          { id: 'c-2', contractId: 'contract-2', overdueSince: day('2026-03-14') },
          { id: 'c-3', contractId: 'contract-3', stage: S.Cerrado, overdueSince: day('2026-01-01'), closedAt: day('2026-02-01') },
        ],
        penalties: { 'liq-mar': '2000.00' },
        users: [{ id: 'user-9', firstName: 'Lía', lastName: 'Demo' }],
      });
      f.cases[0].assigneeId = 'user-9';
      const page = await f.service.list({});
      expect(page.total).toBe(2);
      expect(page.items.map((i) => i.id)).toEqual(['c-1', 'c-2']);
      expect(page.items[0]).toMatchObject({
        propertyLabel: 'Calle Demo 742',
        tenantNames: 'Ana Prueba',
        daysOverdue: 10,
        balance: '100000.00',
        payoffToday: '102000.00',
        assigneeName: 'Lía Demo',
        planStatus: 'Scheduled',
        pausedUntil: null,
      });
      expect(page.totalPages).toBe(1);
    });

    it('filtra por etapa, mora mínima, responsable y contrato', async () => {
      at('2026-03-20');
      const f = makeFakeCollections({
        liquidaciones: [MARCH],
        cases: [
          { id: 'c-1', stage: S.Prejudicial, overdueSince: day('2026-03-10'), assigneeId: 'user-1' },
          { id: 'c-2', contractId: 'contract-2', overdueSince: day('2026-03-18') },
        ],
      });
      expect((await f.service.list({ stage: 'Prejudicial' })).items.map((i) => i.id)).toEqual(['c-1']);
      expect((await f.service.list({ minDays: '5' })).items.map((i) => i.id)).toEqual(['c-1']);
      expect((await f.service.list({ assigneeId: '5b3a8c1e-6c5d-4a49-9d6a-0f2f1a1b2c3d' })).items).toHaveLength(0);
      expect((await f.service.list({ contractId: '5b3a8c1e-6c5d-4a49-9d6a-0f2f1a1b2c3d' })).items).toHaveLength(0);
    });

    it('rechaza filtros inválidos', async () => {
      const f = makeFakeCollections();
      await expect(f.service.list({ stage: 'Nada' })).rejects.toMatchObject({ response: expect.objectContaining({ message: 'Invalid collection filter' }) });
    });

    it('el detalle trae la deuda de hoy y la línea de tiempo con el estado del mensaje y quién lo hizo', async () => {
      at('2026-03-20');
      const f = makeFakeCollections({
        liquidaciones: [MARCH],
        cases: [{ id: 'case-1', letterPreparedOn: day('2026-03-20') }],
        users: [{ id: 'user-1', firstName: 'Rosa', lastName: 'Demo' }],
        actions: [
          { id: 'a-1', kind: K.Recordatorio, level: 1, channel: 'WhatsApp', outboxMessageId: 'msg-1', amount: '100000.00', onDate: day('2026-03-15'), at: day('2026-03-15') },
          { id: 'a-2', kind: K.Nota, note: 'Habló por teléfono', createdByUserId: 'user-1', at: day('2026-03-16') },
          { id: 'a-3', kind: K.CartaDocumento, status: CollectionActionStatus.Preparada, data: LETTER, at: day('2026-03-20') },
        ],
      });
      f.messages.push({ id: 'msg-1', status: 'Sent', statusReason: null });
      const detail = await f.service.get('case-1');
      expect(detail.debt).toEqual([
        { liquidacionId: 'liq-mar', period: '2026-03-01T00:00:00.000Z', dueDate: '2026-03-10T00:00:00.000Z', daysOverdue: 10, balance: '100000.00', penalty: '0.00', total: '100000.00' },
      ]);
      expect(detail.actions.map((a) => a.id)).toEqual(['a-3', 'a-2', 'a-1']);
      expect(detail.actions[2]).toMatchObject({ messageStatus: 'Sent', channel: 'WhatsApp', amount: '100000.00' });
      expect(detail.actions[1]).toMatchObject({ createdByName: 'Rosa Demo', note: 'Habló por teléfono' });
      expect(detail.actions[0].letter).toEqual(LETTER);
      expect(detail.planStatus).toBe('AwaitingLetterConfirmation');
    });

    it('un caso inexistente es 404', async () => {
      const f = makeFakeCollections();
      await expect(f.service.get('nada')).rejects.toMatchObject({ response: expect.objectContaining({ error: 'COLLECTION_CASE_NOT_FOUND' }) });
    });

    it('un caso cerrado se ve con su motivo y sin próxima acción', async () => {
      at('2026-03-20');
      const f = makeFakeCollections({
        cases: [{ id: 'case-1', stage: S.Cerrado, closeReason: 'Pagado', closedAt: day('2026-03-18'), nextActionKind: K.Recordatorio }],
      });
      const detail = await f.service.get('case-1');
      expect(detail).toMatchObject({ closeReason: 'Pagado', nextAction: null, nextActionAt: null, planStatus: 'Close', closedAt: '2026-03-18T00:00:00.000Z' });
    });

    it('un caso derivado figura como manual y uno con acuerdo vigente como pausado', async () => {
      at('2026-03-20');
      const f = makeFakeCollections({
        liquidaciones: [MARCH],
        cases: [
          { id: 'c-1', stage: S.Abogado },
          { id: 'c-2', contractId: 'contract-1', pausedUntil: day('2026-03-30') },
        ],
      });
      expect((await f.service.get('c-1')).planStatus).toBe('Manual');
      expect(await f.service.get('c-2')).toMatchObject({ planStatus: 'Paused', pausedUntil: '2026-03-30T00:00:00.000Z' });
    });
  });

  describe('acciones manuales', () => {
    it('agrega una nota auditada con quien la escribió', async () => {
      at('2026-03-20');
      const f = makeFakeCollections({ liquidaciones: [MARCH], cases: [{ id: 'case-1' }], users: [{ id: 'user-1', firstName: 'Rosa', lastName: 'Demo' }] });
      const detail = await f.service.addNote('case-1', { note: '  Prometió pagar el viernes ' });
      expect(detail.actions[0]).toMatchObject({ kind: K.Nota, note: 'Prometió pagar el viernes', createdByName: 'Rosa Demo' });
      expect(f.audits[0]).toMatchObject({ entity: 'CollectionCase', entityId: 'case-1', metadata: { operation: 'collection-note' } });
      await expect(f.service.addNote('case-1', { note: '' })).rejects.toBeDefined();
    });

    it('un acuerdo de pago pausa el caso hasta su fecha', async () => {
      at('2026-03-20');
      const f = makeFakeCollections({ liquidaciones: [MARCH], cases: [{ id: 'case-1', nextActionKind: K.RecordatorioFirme }] });
      const detail = await f.service.agree('case-1', { payOn: '2026-03-28', amount: '50000', note: 'Paga la mitad' });
      expect(f.cases[0].pausedUntil).toEqual(day('2026-03-28'));
      expect(detail.actions[0]).toMatchObject({ kind: K.Acuerdo, onDate: '2026-03-28T00:00:00.000Z', amount: '50000.00', note: 'Paga la mitad' });
      expect(detail).toMatchObject({ planStatus: 'Paused', nextAction: null });
      expect(f.cases[0].nextActionAt).toEqual(day('2026-03-29'));
    });

    it('un acuerdo con fecha pasada o a más de un año es inválido', async () => {
      at('2026-03-20');
      const f = makeFakeCollections({ liquidaciones: [MARCH], cases: [{ id: 'case-1' }] });
      await expect(f.service.agree('case-1', { payOn: '2026-03-19' })).rejects.toMatchObject({ response: expect.objectContaining({ error: 'AGREEMENT_DATE_OUT_OF_RANGE' }) });
      await expect(f.service.agree('case-1', { payOn: '2027-03-21' })).rejects.toMatchObject({ response: expect.objectContaining({ error: 'AGREEMENT_DATE_OUT_OF_RANGE' }) });
      await expect(f.service.agree('case-1', { payOn: 'mañana' })).rejects.toBeDefined();
    });

    it('edita los campos del borrador de la carta mientras no se confirme el envío', async () => {
      at('2026-04-11');
      const f = makeFakeCollections({
        liquidaciones: [MARCH, APRIL],
        cases: [{ id: 'case-1', stage: S.Prejudicial, letterPreparedOn: day('2026-04-11') }],
        actions: [{ id: 'let-1', kind: K.CartaDocumento, status: CollectionActionStatus.Preparada, data: LETTER, at: day('2026-04-11') }],
      });
      const detail = await f.service.updateLetter('case-1', 'let-1', { recipientAddress: 'Av. Demo 55', termDays: 15, extraText: 'Se adjunta el contrato.' });
      expect(detail.actions[0].letter).toEqual({ ...LETTER, recipientAddress: 'Av. Demo 55', termDays: 15, extraText: 'Se adjunta el contrato.' });
      await expect(f.service.updateLetter('case-1', 'let-1', { desconocido: 1 })).rejects.toBeDefined();
      await expect(f.service.updateLetter('case-1', 'otra', {})).rejects.toMatchObject({ response: expect.objectContaining({ error: 'LETTER_NOT_FOUND' }) });
    });

    it('confirmar el envío fija la fecha, la marca realizada y programa la derivación a los 10 días', async () => {
      at('2026-04-14');
      const f = makeFakeCollections({
        liquidaciones: [MARCH, APRIL],
        cases: [{ id: 'case-1', stage: S.Prejudicial, letterPreparedOn: day('2026-04-11') }],
        actions: [{ id: 'let-1', kind: K.CartaDocumento, status: CollectionActionStatus.Preparada, data: LETTER, at: new Date('2026-04-11T13:00:00.000Z') }],
      });
      const detail = await f.service.confirmLetterSent('case-1', 'let-1', { sentOn: '2026-04-13', note: 'Correo Argentino, pieza 123' });
      expect(detail.actions[0]).toMatchObject({ status: CollectionActionStatus.Realizada, onDate: '2026-04-13T00:00:00.000Z', note: 'Correo Argentino, pieza 123' });
      expect(f.cases[0].letterSentOn).toEqual(day('2026-04-13'));
      expect(detail).toMatchObject({ nextAction: K.DerivacionAbogado, nextActionManual: true });
      expect(f.cases[0].nextActionAt).toEqual(day('2026-04-23'));
      expect(f.cases[0].stage).toBe(S.Prejudicial);
    });

    it('no confirma un envío futuro, anterior al borrador ni uno ya confirmado', async () => {
      at('2026-04-14');
      const f = makeFakeCollections({
        liquidaciones: [MARCH, APRIL],
        cases: [{ id: 'case-1', stage: S.Prejudicial, letterPreparedOn: day('2026-04-11') }],
        actions: [
          { id: 'let-1', kind: K.CartaDocumento, status: CollectionActionStatus.Preparada, data: LETTER, at: new Date('2026-04-11T13:00:00.000Z') },
          { id: 'let-2', kind: K.CartaDocumento, status: CollectionActionStatus.Realizada, data: LETTER, at: new Date('2026-04-01T13:00:00.000Z') },
        ],
      });
      await expect(f.service.confirmLetterSent('case-1', 'let-1', { sentOn: '2026-04-15' })).rejects.toMatchObject({ response: expect.objectContaining({ error: 'LETTER_SENT_DATE_INVALID' }) });
      await expect(f.service.confirmLetterSent('case-1', 'let-1', { sentOn: '2026-04-10' })).rejects.toMatchObject({ response: expect.objectContaining({ error: 'LETTER_SENT_DATE_INVALID' }) });
      await expect(f.service.confirmLetterSent('case-1', 'let-2', { sentOn: '2026-04-13' })).rejects.toMatchObject({ response: expect.objectContaining({ error: 'LETTER_ALREADY_SENT' }) });
      await expect(f.service.updateLetter('case-1', 'let-2', { termDays: 5 })).rejects.toMatchObject({ response: expect.objectContaining({ error: 'LETTER_ALREADY_SENT' }) });
    });

    it('derivar a un abogado pasa el caso a Abogado y es una acción de una persona', async () => {
      at('2026-04-25');
      const f = makeFakeCollections({ liquidaciones: [MARCH, APRIL], cases: [{ id: 'case-1', stage: S.Prejudicial, letterSentOn: day('2026-04-13') }] });
      const detail = await f.service.derive('case-1', { lawyer: 'Estudio Demo', note: 'Plazo vencido' });
      expect(detail).toMatchObject({ stage: S.Abogado, planStatus: 'Manual', nextAction: null });
      expect(detail.actions[0]).toMatchObject({ kind: K.DerivacionAbogado, note: 'Plazo vencido' });
      expect(f.actions[0].data).toEqual({ lawyer: 'Estudio Demo' });
      expect(f.audits.some((a: any) => a.metadata?.operation === 'collection-derive')).toBe(true);
    });

    it('del estado Abogado se pasa a Judicial, y no se puede saltar de Recordatorio a Judicial', async () => {
      at('2026-04-25');
      const f = makeFakeCollections({
        liquidaciones: [MARCH],
        cases: [{ id: 'c-a', stage: S.Abogado }, { id: 'c-r', contractId: 'contract-2', stage: S.Recordatorio }],
      });
      const detail = await f.service.judicialize('c-a', { note: 'Expediente 1234/26' });
      expect(detail.stage).toBe(S.Judicial);
      expect(detail.actions[0].note).toBe('Pasó a la vía judicial. Expediente 1234/26');
      await expect(f.service.judicialize('c-r', undefined)).rejects.toMatchObject({ response: expect.objectContaining({ error: 'INVALID_TRANSITION' }) });
    });

    it('cerrar a mano exige un motivo, deja la nota y no admite más acciones', async () => {
      at('2026-03-20');
      const f = makeFakeCollections({ liquidaciones: [MARCH], cases: [{ id: 'case-1' }] });
      await expect(f.service.close('case-1', { note: '' })).rejects.toBeDefined();
      const detail = await f.service.close('case-1', { note: 'Pagó en efectivo en la oficina' });
      expect(detail).toMatchObject({ stage: S.Cerrado, closeReason: 'Manual', nextAction: null });
      expect(detail.actions[0]).toMatchObject({ kind: K.Nota, note: 'Caso cerrado: Pagó en efectivo en la oficina' });
      await expect(f.service.addNote('case-1', { note: 'x' })).rejects.toMatchObject({ response: expect.objectContaining({ error: 'CASE_CLOSED' }) });
    });

    it('asigna el caso a un usuario activo y lo puede desasignar', async () => {
      at('2026-03-20');
      const f = makeFakeCollections({
        liquidaciones: [MARCH],
        cases: [{ id: 'case-1' }],
        users: [{ id: '5b3a8c1e-6c5d-4a49-9d6a-0f2f1a1b2c3d', firstName: 'Lía', lastName: 'Demo' }, { id: '6b3a8c1e-6c5d-4a49-9d6a-0f2f1a1b2c3d', firstName: 'Baja', lastName: 'Demo', isActive: false }],
      });
      const detail = await f.service.assign('case-1', { assigneeId: '5b3a8c1e-6c5d-4a49-9d6a-0f2f1a1b2c3d' });
      expect(detail.assigneeName).toBe('Lía Demo');
      await expect(f.service.assign('case-1', { assigneeId: '6b3a8c1e-6c5d-4a49-9d6a-0f2f1a1b2c3d' })).rejects.toMatchObject({ response: expect.objectContaining({ error: 'ASSIGNEE_NOT_FOUND' }) });
      expect((await f.service.assign('case-1', { assigneeId: null })).assigneeId).toBeNull();
    });

    it('devuelve los campos de la carta para el PDF', async () => {
      const f = makeFakeCollections({
        cases: [{ id: 'case-1' }],
        actions: [{ id: 'let-1', kind: K.CartaDocumento, status: CollectionActionStatus.Preparada, data: LETTER }],
      });
      expect(await f.service.letterFor('case-1', 'let-1')).toEqual({ fields: LETTER, status: CollectionActionStatus.Preparada, sentOn: null });
      expect(f.service.currentTenantId()).toBe('tenant-1');
    });
  });
});

describe('ayudas de la deuda', () => {
  it('da formato al importe y junta los períodos sin repetir', () => {
    expect(formatDebtAmount('ARS', '1234.5')).toBe('ARS 1.234,50');
    const lines = [{ period: day('2026-03-01') }, { period: day('2026-03-01') }, { period: day('2026-04-01') }] as any[];
    expect(overduePeriods({ overdue: lines })).toEqual(['03/2026', '04/2026']);
  });
});
