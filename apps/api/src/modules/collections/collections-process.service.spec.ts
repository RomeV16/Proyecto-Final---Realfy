import { CollectionActionKind as K, CollectionActionStatus, CollectionStage as S, MESSAGE_TEMPLATES, MessageChannel } from '@realfy/shared';
import { renderEmail, whatsappParams } from '../../common/messaging/message-templates';
import { reminderTemplate } from './collections-process.service';
import { day, makeFakeCollections, type FakeLiquidacion } from './collections.testing';

const MARCH: FakeLiquidacion = { id: 'liq-mar', period: day('2026-03-01'), dueDate: day('2026-03-10'), total: '100000.00' };
const APRIL: FakeLiquidacion = { id: 'liq-apr', period: day('2026-04-01'), dueDate: day('2026-04-10'), total: '100000.00' };

const kindsOf = (actions: any[]) => actions.map((a) => `${a.kind}${a.level ? `:${a.level}` : ''}`);

describe('proceso diario de cobranza', () => {
  describe('apertura de casos', () => {
    it('abre un caso por contrato aunque tenga varias liquidaciones vencidas', async () => {
      const f = makeFakeCollections({ liquidaciones: [MARCH, APRIL] });
      const res = await f.process.runTenant('tenant-1', day('2026-04-20'));
      expect(res.opened).toBe(1);
      expect(f.cases).toHaveLength(1);
      // Una mora de más de un mes pasa directo a la carta (sin un recordatorio amable de por medio).
      expect(f.cases[0]).toMatchObject({ contractId: 'contract-1', overdueSince: day('2026-03-10'), stage: S.Prejudicial });
      expect(res).toMatchObject({ lettersPrepared: 1, remindersQueued: 0 });
    });

    it('no abre nada si la liquidación todavía no venció o ya se pagó', async () => {
      const f = makeFakeCollections({
        liquidaciones: [
          { ...MARCH, dueDate: day('2026-03-15') },
          { ...APRIL, id: 'paid', payments: [{ amount: '100000.00', paidAt: day('2026-04-11') }] },
        ],
      });
      const res = await f.process.runTenant('tenant-1', day('2026-03-15'));
      expect(res.opened).toBe(0);
      expect(f.cases).toHaveLength(0);
    });

    it('con la cobranza apagada no abre casos ni manda nada', async () => {
      const f = makeFakeCollections({ liquidaciones: [MARCH], defaults: {} });
      const res = await f.process.runTenant('tenant-1', day('2026-03-20'));
      expect(res).toMatchObject({ opened: 0, remindersQueued: 0 });
      expect(f.outbox.enqueue).not.toHaveBeenCalled();
    });

    it('un contrato que ya tiene un caso abierto no abre otro', async () => {
      const f = makeFakeCollections({ liquidaciones: [MARCH], cases: [{ stage: S.Recordatorio }] });
      const res = await f.process.runTenant('tenant-1', day('2026-03-12'));
      expect(res.opened).toBe(0);
      expect(f.cases).toHaveLength(1);
    });

    it('si abrir un caso falla, lo cuenta y sigue con los demás', async () => {
      const f = makeFakeCollections({ liquidaciones: [MARCH] });
      f.db.collectionCase.create.mockRejectedValueOnce(new Error('boom'));
      const res = await f.process.runTenant('tenant-1', day('2026-03-12'));
      expect(res).toMatchObject({ opened: 0, failed: 1 });
    });
  });

  describe('recordatorios', () => {
    it('a los 5 días encola el recordatorio amable con el importe exacto de hoy (saldo más punitorios)', async () => {
      const f = makeFakeCollections({
        liquidaciones: [{ ...MARCH, payments: [{ amount: '40000.00', paidAt: day('2026-03-12') }] }],
        penalties: { 'liq-mar': '1500.50' },
      });
      const res = await f.process.runTenant('tenant-1', day('2026-03-15'));
      expect(res.remindersQueued).toBe(1);
      expect(f.outbox.enqueue).toHaveBeenCalledTimes(1);
      const input = f.outbox.enqueue.mock.calls[0][1];
      expect(input).toMatchObject({
        channel: MessageChannel.WhatsApp,
        templateKey: 'payment_reminder_1',
        personId: 'person-1',
        relatedType: 'CollectionCase',
        idempotencyKey: `CollectionReminder:${f.cases[0].id}:1:2026-03-15:person-1:WhatsApp`,
        createdByUserId: null,
      });
      expect(input.vars).toEqual({ name: 'Ana Prueba', amount: 'ARS 61.500,50', periods: '03/2026', agency: 'Inmobiliaria Demo' });
      expect(f.actions[0]).toMatchObject({ kind: K.Recordatorio, level: 1, channel: 'WhatsApp', outboxMessageId: 'msg-1', amount: '61500.50' });
    });

    it('antes del día 5 no manda nada', async () => {
      const f = makeFakeCollections({ liquidaciones: [MARCH] });
      const res = await f.process.runTenant('tenant-1', day('2026-03-14'));
      expect(res.remindersQueued).toBe(0);
      expect(f.cases[0]).toMatchObject({ nextActionKind: K.Recordatorio });
      expect(f.cases[0].nextActionAt).toEqual(day('2026-03-15'));
    });

    it('cada 5 días sube el tono: 5, 10 y 15 días con plantillas de nivel 1, 2 y 3', async () => {
      const f = makeFakeCollections({ liquidaciones: [MARCH, { ...APRIL, status: 'Aprobada' }] });
      for (const today of ['2026-03-15', '2026-03-20', '2026-03-25', '2026-03-30']) {
        await f.process.runTenant('tenant-1', day(today));
      }
      expect(f.outbox.enqueue.mock.calls.map((c: any[]) => c[1].templateKey)).toEqual([
        'payment_reminder_1',
        'payment_reminder_2',
        'payment_reminder_3',
      ]);
      expect(kindsOf(f.actions)).toEqual([`${K.Recordatorio}:1`, `${K.RecordatorioFirme}:2`, `${K.RecordatorioFirme}:3`]);
    });

    it('correr dos veces el mismo día no repite el recordatorio', async () => {
      const f = makeFakeCollections({ liquidaciones: [MARCH] });
      await f.process.runTenant('tenant-1', day('2026-03-15'));
      const again = await f.process.runTenant('tenant-1', day('2026-03-15'));
      expect(again.remindersQueued).toBe(0);
      expect(f.outbox.enqueue).toHaveBeenCalledTimes(1);
    });

    it('si ya existe la acción de ese día (corrida a medias), no vuelve a encolar', async () => {
      const f = makeFakeCollections({
        liquidaciones: [MARCH],
        cases: [{ lastBalance: '100000.00' }],
        actions: [{ caseId: 'case-1', kind: K.Recordatorio, level: 1, key: `${K.Recordatorio}:1:2026-03-15:person-1`, status: CollectionActionStatus.Realizada }],
      });
      await f.process.runTenant('tenant-1', day('2026-03-15'));
      expect(f.outbox.enqueue).not.toHaveBeenCalled();
    });

    it('avisa por mail cuando la persona no tiene WhatsApp con alta', async () => {
      const f = makeFakeCollections({ liquidaciones: [MARCH], channelFor: () => 'Email' });
      await f.process.runTenant('tenant-1', day('2026-03-15'));
      expect(f.outbox.enqueue.mock.calls[0][1].channel).toBe(MessageChannel.Email);
      expect(f.actions[0].channel).toBe('Email');
    });

    it('avisa a cada inquilino del contrato que tenga un canal', async () => {
      const f = makeFakeCollections({
        liquidaciones: [MARCH],
        tenants: [
          { id: 'p1', firstName: 'Ana', lastName: 'Prueba', phone: '1155550000' },
          { id: 'p2', firstName: 'Beto', lastName: 'Demo', email: 'beto@inmobiliariademo.com.ar' },
          { id: 'p3', firstName: 'Sin', lastName: 'Contacto' },
        ],
      });
      const res = await f.process.runTenant('tenant-1', day('2026-03-15'));
      expect(res.remindersQueued).toBe(2);
      expect(f.actions.map((a: any) => a.channel)).toEqual(['WhatsApp', 'Email']);
    });

    it('sin ningún canal disponible lo deja registrado, avanza el ritmo y avisa a la gerencia', async () => {
      const f = makeFakeCollections({ liquidaciones: [MARCH], channelFor: () => null });
      const res = await f.process.runTenant('tenant-1', day('2026-03-15'));
      expect(res.remindersQueued).toBe(0);
      expect(f.outbox.enqueue).not.toHaveBeenCalled();
      expect(f.actions[0]).toMatchObject({ kind: K.Recordatorio, channel: null, note: expect.stringContaining('Sin medio de contacto') });
      expect(f.cases[0].nextActionKind).toBe(K.RecordatorioFirme);
      expect(f.notices).toHaveLength(2);
      expect(f.notices[0]).toMatchObject({ type: 'SystemAlert', entityType: 'CollectionCase', entityId: f.cases[0].id });
    });

    it('un contrato sin inquilinos cargados se trata como sin medio de contacto', async () => {
      const f = makeFakeCollections({ liquidaciones: [MARCH], tenants: [] });
      await f.process.runTenant('tenant-1', day('2026-03-15'));
      expect(f.actions[0].channel).toBeNull();
    });
  });

  describe('prejudicial y carta documento', () => {
    const reminders = [
      { kind: K.Recordatorio, level: 1, onDate: day('2026-03-15') },
      { kind: K.RecordatorioFirme, level: 2, onDate: day('2026-03-20') },
      { kind: K.RecordatorioFirme, level: 3, onDate: day('2026-03-25') },
    ];

    it('al vencer el siguiente alquiler impago prepara el borrador de la carta documento y no manda nada', async () => {
      const f = makeFakeCollections({
        liquidaciones: [MARCH, APRIL],
        cases: [{ lastBalance: '200000.00' }],
        actions: reminders,
        penalties: { 'liq-mar': '3000.00', 'liq-apr': '0' },
      });
      const res = await f.process.runTenant('tenant-1', day('2026-04-11'));
      expect(res.lettersPrepared).toBe(1);
      expect(f.outbox.enqueue).not.toHaveBeenCalled();
      const letter = f.actions.find((a: any) => a.kind === K.CartaDocumento);
      expect(letter).toMatchObject({ status: CollectionActionStatus.Preparada, onDate: null, amount: '203000.00' });
      expect(letter.data).toEqual({
        recipientName: 'Ana Prueba',
        recipientAddress: 'Calle Falsa 123',
        propertyAddress: 'Calle Demo 742',
        periods: '03/2026 y 04/2026',
        amount: 'ARS 203.000,00',
        issuedOn: '11/04/2026',
        termDays: 10,
        extraText: '',
      });
      expect(f.cases[0]).toMatchObject({ stage: S.Prejudicial, letterPreparedOn: day('2026-04-11'), nextActionKind: K.CartaDocumento });
      expect(f.notices[0]).toMatchObject({ title: 'Carta documento preparada' });
    });

    it('con la carta preparada no la vuelve a preparar ni manda recordatorios: espera la confirmación', async () => {
      const f = makeFakeCollections({
        liquidaciones: [MARCH, APRIL],
        cases: [{ stage: S.Prejudicial, letterPreparedOn: day('2026-04-11'), lastBalance: '200000.00' }],
        actions: reminders,
      });
      const res = await f.process.runTenant('tenant-1', day('2026-04-25'));
      expect(res).toMatchObject({ lettersPrepared: 0, remindersQueued: 0 });
      expect(f.actions).toHaveLength(3);
    });

    it('con la carta enviada, el día que vence el plazo avisa a la gerencia para evaluar derivar, y no deriva', async () => {
      const f = makeFakeCollections({
        liquidaciones: [MARCH, APRIL],
        cases: [{ stage: S.Prejudicial, letterPreparedOn: day('2026-04-11'), letterSentOn: day('2026-04-13'), lastBalance: '200000.00' }],
      });
      await f.process.runTenant('tenant-1', day('2026-04-23'));
      expect(f.cases[0].stage).toBe(S.Prejudicial);
      expect(f.notices[0].title).toBe('Venció el plazo de la carta documento');
      expect(f.notices).toHaveLength(2);
      // El día siguiente no repite el aviso.
      f.notices.length = 0;
      await f.process.runTenant('tenant-1', day('2026-04-24'));
      expect(f.notices).toHaveLength(0);
    });

    it('un caso derivado a un abogado no recibe acciones automáticas', async () => {
      const f = makeFakeCollections({
        liquidaciones: [MARCH],
        cases: [{ stage: S.Abogado, lastBalance: '100000.00' }],
      });
      const res = await f.process.runTenant('tenant-1', day('2026-05-20'));
      expect(res).toMatchObject({ remindersQueued: 0, lettersPrepared: 0, closed: 0 });
    });
  });

  describe('pagos y acuerdos', () => {
    it('un pago parcial deja el caso abierto y lo anota en la línea de tiempo', async () => {
      const f = makeFakeCollections({
        liquidaciones: [{ ...MARCH, payments: [{ amount: '30000.00', paidAt: day('2026-03-13') }] }],
        cases: [{ lastBalance: '100000.00' }],
      });
      const res = await f.process.runTenant('tenant-1', day('2026-03-14'));
      expect(res.closed).toBe(0);
      expect(f.cases[0].stage).toBe(S.Recordatorio);
      expect(f.cases[0].lastBalance).toBe('70000.00');
      expect(f.actions[0]).toMatchObject({ kind: K.Pago, amount: '30000.00', note: expect.stringContaining('Pago parcial') });
    });

    it('un pago total cierra el caso con el motivo Pagado', async () => {
      const f = makeFakeCollections({
        liquidaciones: [{ ...MARCH, status: 'Pagada', payments: [{ amount: '100000.00', paidAt: day('2026-03-13') }] }],
        cases: [{ lastBalance: '100000.00' }],
      });
      const res = await f.process.runTenant('tenant-1', day('2026-03-14'));
      expect(res.closed).toBe(1);
      expect(f.cases[0]).toMatchObject({ stage: S.Cerrado, closeReason: 'Pagado', nextActionKind: null });
      expect(f.cases[0].closedAt).toBeInstanceOf(Date);
      expect(f.actions[0]).toMatchObject({ kind: K.Pago, amount: '100000.00', createdByUserId: null });
      expect(f.audits.find((a: any) => a.metadata?.operation === 'collection-case-close')).toMatchObject({ userId: null });
    });

    it('el acuerdo de pago pausa los recordatorios hasta su fecha', async () => {
      const f = makeFakeCollections({
        liquidaciones: [MARCH],
        cases: [{ pausedUntil: day('2026-03-30'), lastBalance: '100000.00' }],
      });
      const paused = await f.process.runTenant('tenant-1', day('2026-03-22'));
      expect(paused.remindersQueued).toBe(0);
      expect(f.outbox.enqueue).not.toHaveBeenCalled();
      const resumed = await f.process.runTenant('tenant-1', day('2026-03-31'));
      expect(resumed.remindersQueued).toBe(1);
    });
  });

  describe('corrida completa y errores', () => {
    it('suma lo hecho en todas las inmobiliarias', async () => {
      const f = makeFakeCollections({ liquidaciones: [MARCH] });
      const res = await f.process.runAll(day('2026-03-15'));
      expect(res).toMatchObject({ tenantsProcessed: 1, opened: 1, remindersQueued: 1, failed: 0 });
    });

    it('un caso que falla se cuenta y no corta a los demás', async () => {
      const f = makeFakeCollections({
        liquidaciones: [MARCH, { ...MARCH, id: 'liq-b', contractId: 'contract-2' }],
        cases: [
          { id: 'case-x', contractId: 'contract-1', lastBalance: '100000.00' },
          { id: 'case-y', contractId: 'contract-2', lastBalance: '100000.00' },
        ],
      });
      f.outbox.enqueue.mockRejectedValueOnce(new Error('proveedor caído'));
      const res = await f.process.runTenant('tenant-1', day('2026-03-15'));
      expect(res.failed).toBe(1);
      expect(res.remindersQueued).toBe(1);
    });

    it('un caso que desapareció o ya estaba cerrado se ignora', async () => {
      const f = makeFakeCollections({ liquidaciones: [MARCH], cases: [{ lastBalance: '100000.00' }] });
      f.db.collectionCase.findFirst.mockResolvedValueOnce(null);
      const res = await f.process.runTenant('tenant-1', day('2026-03-15'));
      expect(res).toMatchObject({ failed: 0, remindersQueued: 0 });
    });
  });
});

describe('plantillas de los recordatorios', () => {
  it('el nivel elige la plantilla (de 1 a 3, acotado)', () => {
    expect(reminderTemplate(0)).toBe('payment_reminder_1');
    expect(reminderTemplate(1)).toBe('payment_reminder_1');
    expect(reminderTemplate(2)).toBe('payment_reminder_2');
    expect(reminderTemplate(3)).toBe('payment_reminder_3');
    expect(reminderTemplate(9)).toBe('payment_reminder_3');
  });

  it.each(['payment_reminder_1', 'payment_reminder_2', 'payment_reminder_3'] as const)('%s existe en mail y en WhatsApp con las cuatro variables', (key) => {
    const info = MESSAGE_TEMPLATES[key];
    expect(info.channels).toEqual([MessageChannel.Email, MessageChannel.WhatsApp]);
    expect(info.vars).toEqual(['name', 'amount', 'periods', 'agency']);
    expect(info.whatsapp?.name).toMatch(/^recordatorio_de_pago_n[123]$/);
    const vars = { name: 'Ana', amount: 'ARS 61.500,50', periods: '03/2026 y 04/2026', agency: 'Inmobiliaria Demo' };
    const mail = renderEmail(key, vars);
    expect(mail.subject).toContain('Inmobiliaria Demo');
    expect(mail.html).toContain('ARS 61.500,50');
    expect(mail.html).toContain('03/2026 y 04/2026');
    expect(whatsappParams(key, vars)).toEqual(['Ana', 'ARS 61.500,50', '03/2026 y 04/2026', 'Inmobiliaria Demo']);
  });

  it('ninguna plantilla amenaza ni cita plazos o acciones legales concretas', () => {
    for (const key of ['payment_reminder_1', 'payment_reminder_2', 'payment_reminder_3'] as const) {
      const text = `${MESSAGE_TEMPLATES[key].whatsappText} ${renderEmail(key, { name: 'x', amount: 'x', periods: 'x', agency: 'x' }).html}`.toLowerCase();
      for (const forbidden of ['carta documento', 'abogado', 'juicio', 'desalojo', 'demanda', 'embargo', 'denuncia', 'policía']) {
        expect(text).not.toContain(forbidden);
      }
    }
  });
});
