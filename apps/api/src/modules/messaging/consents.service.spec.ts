import { ConsentsService } from './consents.service';

const PERSON = { id: 'p-1', email: 'Iris@Example.com', phone: '351 555-0101' };

function build(person: any = PERSON, rows: any[] = []) {
  const client: any = {
    person: { findFirst: jest.fn().mockResolvedValue(person) },
    contactConsent: {
      findMany: jest.fn(async () => [...rows].sort((a, b) => b.at.getTime() - a.at.getTime())),
      create: jest.fn(async ({ data }: any) => {
        const r = { id: `c${rows.length + 1}`, at: new Date(Date.UTC(2026, 10, 2, 12, rows.length)), ...data };
        rows.push(r);
        return r;
      }),
    },
  };
  const tenantContext: any = { getTenantId: () => 't-1', getUserId: () => 'u-1' };
  return { service: new ConsentsService({ client } as any, tenantContext), client, rows };
}

describe('ConsentsService', () => {
  it('sin registros: los dos canales sin registrar, con la dirección actual de la persona', async () => {
    const res = await build().service.forPerson('p-1');
    expect(res).toEqual({
      personId: 'p-1',
      channels: [
        { channel: 'Email', status: null, source: null, at: null, note: null, address: 'iris@example.com', history: [] },
        { channel: 'WhatsApp', status: null, source: null, at: null, note: null, address: '5493515550101', history: [] },
      ],
    });
  });

  it('registrar un alta agrega un registro al historial con quién y a qué dirección', async () => {
    const { service, client } = build();
    const res = await service.set('p-1', { channel: 'WhatsApp', status: 'OptIn', note: 'Lo pidió por escrito en el contrato' });
    expect(client.contactConsent.create).toHaveBeenCalledWith({
      data: {
        tenantId: 't-1',
        personId: 'p-1',
        channel: 'WhatsApp',
        address: '5493515550101',
        status: 'OptIn',
        source: 'Manual',
        note: 'Lo pidió por escrito en el contrato',
        recordedByUserId: 'u-1',
      },
    });
    const wa = res.channels.find((c) => c.channel === 'WhatsApp')!;
    expect(wa).toMatchObject({ status: 'OptIn', source: 'Manual', note: 'Lo pidió por escrito en el contrato' });
    expect(wa.history).toHaveLength(1);
  });

  it('vale el último registro: una baja después del alta', async () => {
    const { service } = build();
    await service.set('p-1', { channel: 'WhatsApp', status: 'OptIn' });
    const res = await service.set('p-1', { channel: 'WhatsApp', status: 'OptOut' });
    const wa = res.channels.find((c) => c.channel === 'WhatsApp')!;
    expect(wa.status).toBe('OptOut');
    expect(wa.history.map((h) => h.status)).toEqual(['OptOut', 'OptIn']);
  });

  it('valida el cuerpo y que la persona sea de la inmobiliaria', async () => {
    await expect(build().service.set('p-1', { channel: 'SMS', status: 'OptIn' })).rejects.toMatchObject({
      response: { error: 'VALIDATION_ERROR' },
    });
    await expect(build(null).service.forPerson('p-x')).rejects.toMatchObject({ response: { error: 'PERSON_NOT_FOUND' } });
  });

  it('la baja desde el canal sin persona conocida queda para la dirección', async () => {
    const { service } = build();
    const db = { contactConsent: { createMany: jest.fn() } };
    await service.recordOptOut(db, { tenantId: 't-1', channel: 'WhatsApp' as any, address: '5493515550101', source: 'Inbound' as any, personIds: [] });
    expect(db.contactConsent.createMany.mock.calls[0][0].data).toEqual([
      expect.objectContaining({ personId: null, address: '5493515550101', status: 'OptOut', note: 'Pidió la baja respondiendo al mensaje' }),
    ]);
  });
});
