import { ConfigService } from '@nestjs/config';
import { MessageChannel } from '@realfy/shared';
import { MessagingConfigService } from './messaging-config.service';
import { OutboxService } from './outbox.service';

function service(env: Record<string, string> = {}) {
  const config = new MessagingConfigService({ get: (k: string) => env[k] } as unknown as ConfigService);
  return new OutboxService(config);
}

/** Base de prueba: guarda las filas y respeta la clave única como ON CONFLICT DO NOTHING. */
function memoryDb(persons: Record<string, { email?: string | null; phone?: string | null }> = {}, consents: any[] = []) {
  const rows: any[] = [];
  return {
    rows,
    person: { findFirst: jest.fn(async ({ where }: any) => persons[where.id] ?? null) },
    contactConsent: {
      findFirst: jest.fn(async ({ where }: any) => {
        const match = consents.filter(
          (c) => c.channel === where.channel && (where.personId ? c.personId === where.personId : c.address === where.address),
        );
        return match.sort((a, b) => b.at.getTime() - a.at.getTime())[0] ?? null;
      }),
    },
    messageOutbox: {
      createMany: jest.fn(async ({ data, skipDuplicates }: any) => {
        expect(skipDuplicates).toBe(true);
        let count = 0;
        for (const d of data) {
          if (rows.some((r) => r.idempotencyKey === d.idempotencyKey)) continue;
          rows.push({ id: `m${rows.length + 1}`, ...d });
          count++;
        }
        return { count };
      }),
      findFirst: jest.fn(async ({ where }: any) => rows.find((r) => r.idempotencyKey === where.idempotencyKey) ?? null),
    },
  };
}

const RECEIPT = {
  channel: MessageChannel.Email,
  templateKey: 'receipt' as const,
  vars: { name: 'Iris', number: '00000001', amount: 'ARS 1.000,00', concept: 'alquiler', agency: 'Inmo' },
  relatedType: 'Receipt',
  relatedId: 'r-1',
  idempotencyKey: 'Receipt:r-1:Email',
};

describe('OutboxService.enqueue', () => {
  it('encola con la dirección de la persona, normalizada, y no manda nada', async () => {
    const db = memoryDb({ p1: { email: ' Iris@Example.COM ' } });
    const res = await service({ MESSAGING_MODE: 'live' }).enqueue(db, { ...RECEIPT, personId: 'p1' });
    expect(res).toEqual({ id: 'm1', status: 'Pending', statusReason: null, created: true });
    expect(db.rows[0]).toMatchObject({ to: 'iris@example.com', personId: 'p1', status: 'Pending', templateKey: 'receipt' });
  });

  it('la misma clave devuelve el mensaje ya encolado: exactamente una vez', async () => {
    const db = memoryDb({ p1: { email: 'iris@example.com' } });
    const s = service({ MESSAGING_MODE: 'live' });
    const first = await s.enqueue(db, { ...RECEIPT, personId: 'p1' });
    const again = await s.enqueue(db, { ...RECEIPT, personId: 'p1' });
    expect(again).toEqual({ ...first, created: false });
    expect(db.rows).toHaveLength(1);
  });

  it('con el modo apagado (por defecto) lo guarda con el motivo MESSAGING_OFF', async () => {
    const db = memoryDb();
    const res = await service().enqueue(db, { ...RECEIPT, to: 'iris@example.com' });
    expect(res.statusReason).toBe('MESSAGING_OFF');
    expect(db.rows[0].statusReason).toBe('MESSAGING_OFF');
  });

  it('para WhatsApp usa el teléfono en formato internacional', async () => {
    const db = memoryDb({ p1: { phone: '0351 15 555-0101' } });
    await service().enqueue(db, { ...RECEIPT, channel: MessageChannel.WhatsApp, personId: 'p1', idempotencyKey: 'k-wa' });
    expect(db.rows[0].to).toBe('5493515550101');
  });

  it('sin dirección válida rechaza con NO_CONTACT_ADDRESS', async () => {
    const db = memoryDb({ p1: { email: null, phone: '123' } });
    await expect(service().enqueue(db, { ...RECEIPT, personId: 'p1' })).rejects.toMatchObject({
      response: { error: 'NO_CONTACT_ADDRESS', channel: 'Email' },
    });
    await expect(
      service().enqueue(db, { ...RECEIPT, channel: MessageChannel.WhatsApp, personId: 'p1' }),
    ).rejects.toMatchObject({ response: { error: 'NO_CONTACT_ADDRESS' } });
    expect(db.rows).toHaveLength(0);
  });

  it('una plantilla que no existe en el canal se rechaza (la liquidación va solo por mail)', async () => {
    await expect(
      service().enqueue(memoryDb(), {
        ...RECEIPT,
        templateKey: 'liquidacion',
        channel: MessageChannel.WhatsApp,
        to: '3515550101',
      }),
    ).rejects.toMatchObject({ response: { error: 'MESSAGE_CHANNEL_NOT_SUPPORTED' } });
  });

  it('si la clave es de otra inmobiliaria no revela ese mensaje', async () => {
    const db = memoryDb();
    db.messageOutbox.createMany.mockResolvedValueOnce({ count: 0 });
    db.messageOutbox.findFirst.mockResolvedValueOnce(null);
    await expect(service().enqueue(db, { ...RECEIPT, to: 'iris@example.com' })).rejects.toMatchObject({
      response: { error: 'IDEMPOTENCY_KEY_CONFLICT' },
    });
  });
});

describe('OutboxService.pickChannel', () => {
  const at = (iso: string) => new Date(iso);
  const person = { id: 'p1', email: 'iris@example.com', phone: '3515550101' };

  it('WhatsApp si tiene teléfono y dio el alta', async () => {
    const db = memoryDb({}, [{ personId: 'p1', channel: 'WhatsApp', status: 'OptIn', at: at('2026-10-01') }]);
    expect(await service().pickChannel(db, person, 'ticket_status')).toBe(MessageChannel.WhatsApp);
  });

  it('mail si no hay alta de WhatsApp', async () => {
    expect(await service().pickChannel(memoryDb(), person, 'ticket_status')).toBe(MessageChannel.Email);
  });

  it('una baja de WhatsApp posterior al alta lleva al mail; una baja del mail deja sin canal', async () => {
    const consents = [
      { personId: 'p1', channel: 'WhatsApp', status: 'OptIn', at: at('2026-10-01') },
      { address: '5493515550101', channel: 'WhatsApp', status: 'OptOut', at: at('2026-10-05') },
    ];
    expect(await service().pickChannel(memoryDb({}, consents), person, 'ticket_status')).toBe(MessageChannel.Email);
    const sinMail = [...consents, { personId: 'p1', channel: 'Email', status: 'OptOut', at: at('2026-10-06') }];
    expect(await service().pickChannel(memoryDb({}, sinMail), person, 'ticket_status')).toBeNull();
  });

  it('sin mail ni teléfono no hay canal', async () => {
    expect(await service().pickChannel(memoryDb(), { id: 'p2' }, 'ticket_comment')).toBeNull();
  });
});
