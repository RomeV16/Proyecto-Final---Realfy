import {
  ConversationFilterSchema,
  DEFAULT_INBOX_SETTINGS,
  EmailIngestSchema,
  InboxSettingsSchema,
  LinkConversationSchema,
  RegisterCallSchema,
  ReplyConversationSchema,
  computeSlaDueAt,
  renderInboxText,
  slaState,
} from './index';
import { resolveOperationalDefaults } from '../schemas/operational-defaults.schema';

const HOURS = DEFAULT_INBOX_SETTINGS.businessHours; // lunes a viernes, 9 a 18 (hora de Buenos Aires)
const ALWAYS = { ...HOURS, enabled: false };
// Buenos Aires es UTC-3: 12:00 UTC = 09:00 local.
const at = (iso: string) => new Date(iso);

describe('configuración de la bandeja', () => {
  it('arranca con SLA de 15 minutos, autorrespuesta activa y respuestas rápidas', () => {
    expect(DEFAULT_INBOX_SETTINGS.slaMinutes).toBe(15);
    expect(DEFAULT_INBOX_SETTINGS.autoreply.enabled).toBe(true);
    expect(DEFAULT_INBOX_SETTINGS.autoreply.texts.WhatsApp).toContain('{name}');
    expect(DEFAULT_INBOX_SETTINGS.quickReplies.length).toBeGreaterThan(0);
    expect(DEFAULT_INBOX_SETTINGS.businessHours).toMatchObject({ enabled: true, days: [1, 2, 3, 4, 5], fromHour: 9, untilHour: 18 });
  });

  it('forma parte de los valores por defecto de la inmobiliaria y un JSON viejo se completa', () => {
    expect(resolveOperationalDefaults({}).inbox.slaMinutes).toBe(15);
    expect(resolveOperationalDefaults({ inbox: { slaMinutes: 30 } }).inbox.slaMinutes).toBe(30);
  });

  it('rechaza plazos, horarios y respuestas rápidas inválidos', () => {
    expect(InboxSettingsSchema.safeParse({ slaMinutes: 0 }).success).toBe(false);
    expect(InboxSettingsSchema.safeParse({ businessHours: { fromHour: 10, untilHour: 10 } }).success).toBe(false);
    expect(InboxSettingsSchema.safeParse({ businessHours: { days: [1, 1] } }).success).toBe(false);
    expect(InboxSettingsSchema.safeParse({ businessHours: { days: [] } }).success).toBe(false);
    const q = { id: 'a', title: 'A', body: 'cuerpo' };
    expect(InboxSettingsSchema.safeParse({ quickReplies: [q, q] }).success).toBe(false);
    expect(InboxSettingsSchema.safeParse({ quickReplies: [{ ...q, id: 'Mal Id' }] }).success).toBe(false);
    expect(InboxSettingsSchema.safeParse({ extra: 1 }).success).toBe(false);
  });
});

describe('renderInboxText', () => {
  it('reemplaza el nombre y la inmobiliaria', () => {
    expect(renderInboxText('Hola {name}, gracias por escribir a {agency}.', { name: 'Iris', agency: 'Inmobiliaria Demo' })).toBe(
      'Hola Iris, gracias por escribir a Inmobiliaria Demo.',
    );
  });

  it('sin nombre no queda un hueco', () => {
    expect(renderInboxText('Hola {name}, gracias.', { name: '  ', agency: 'X' })).toBe('Hola, gracias.');
    expect(renderInboxText('{name} escribió', { agency: 'X' })).toBe(' escribió');
  });
});

describe('computeSlaDueAt', () => {
  it('sin horario de atención corre el reloj de pared', () => {
    expect(computeSlaDueAt(at('2026-11-07T23:50:00Z'), 15, ALWAYS)).toEqual(at('2026-11-08T00:05:00Z'));
  });

  it('dentro del horario suma los minutos', () => {
    // martes 3/11 10:00 local
    expect(computeSlaDueAt(at('2026-11-03T13:00:00Z'), 15, HOURS)).toEqual(at('2026-11-03T13:15:00Z'));
  });

  it('antes de abrir cuenta desde la apertura', () => {
    // martes 3/11 07:00 local -> abre 09:00 local
    expect(computeSlaDueAt(at('2026-11-03T10:00:00Z'), 15, HOURS)).toEqual(at('2026-11-03T12:15:00Z'));
  });

  it('cerca del cierre sigue el próximo día hábil', () => {
    // martes 17:50 local, 15 min: 10 hoy + 5 mañana a partir de las 9
    expect(computeSlaDueAt(at('2026-11-03T20:50:00Z'), 15, HOURS)).toEqual(at('2026-11-04T12:05:00Z'));
  });

  it('un viernes tarde pasa al lunes', () => {
    // viernes 6/11 18:30 local -> lunes 9/11 09:15 local
    expect(computeSlaDueAt(at('2026-11-06T21:30:00Z'), 15, HOURS)).toEqual(at('2026-11-09T12:15:00Z'));
  });

  it('un fin de semana cuenta desde el lunes', () => {
    // sábado 7/11 12:00 local
    expect(computeSlaDueAt(at('2026-11-07T15:00:00Z'), 30, HOURS)).toEqual(at('2026-11-09T12:30:00Z'));
  });

  it('un plazo más largo que un día de atención se reparte en varios días', () => {
    // lunes 9/11 17:00 local, 120 minutos: 60 hoy + 60 el martes
    expect(computeSlaDueAt(at('2026-11-09T20:00:00Z'), 120, HOURS)).toEqual(at('2026-11-10T13:00:00Z'));
  });

  it('con días sin atención en el horario cae al reloj de pared pasado el tope de búsqueda', () => {
    const none = { ...HOURS, days: [] as number[] };
    expect(computeSlaDueAt(at('2026-11-03T13:00:00Z'), 15, none)).toEqual(at('2026-11-03T13:15:00Z'));
  });
});

describe('slaState', () => {
  const now = at('2026-11-03T13:00:00Z');
  const base = { firstResponseAt: null, status: 'Nueva' };

  it('con primera respuesta está cumplido', () => {
    expect(slaState({ ...base, slaDueAt: at('2026-11-03T12:00:00Z'), firstResponseAt: at('2026-11-03T12:30:00Z') }, 15, now)).toBe('met');
  });

  it('cerrada o sin vencimiento no tiene plazo', () => {
    expect(slaState({ ...base, slaDueAt: null }, 15, now)).toBe('none');
    expect(slaState({ ...base, slaDueAt: at('2026-11-03T14:00:00Z'), status: 'Resuelta' }, 15, now)).toBe('none');
    expect(slaState({ ...base, slaDueAt: at('2026-11-03T14:00:00Z'), status: 'Archivada' }, 15, now)).toBe('none');
  });

  it('vencida, por vencer (último tercio) y en tiempo', () => {
    expect(slaState({ ...base, slaDueAt: at('2026-11-03T12:59:00Z') }, 15, now)).toBe('breached');
    expect(slaState({ ...base, slaDueAt: at('2026-11-03T13:00:00Z') }, 15, now)).toBe('breached');
    expect(slaState({ ...base, slaDueAt: at('2026-11-03T13:04:00Z') }, 15, now)).toBe('warning');
    expect(slaState({ ...base, slaDueAt: '2026-11-03T13:10:00Z' }, 15, now)).toBe('ok');
  });
});

describe('esquemas de la bandeja', () => {
  it('los booleanos de la query entienden "false"', () => {
    expect(ConversationFilterSchema.parse({ open: 'false', slaBreached: 'true' })).toMatchObject({ open: false, slaBreached: true });
    expect(ConversationFilterSchema.parse({ open: '1' }).open).toBe(true);
    expect(ConversationFilterSchema.parse({ open: '0' }).open).toBe(false);
    expect(ConversationFilterSchema.parse({ open: true }).open).toBe(true);
    expect(ConversationFilterSchema.safeParse({ open: 'quizás' }).success).toBe(false);
  });

  it('el filtro admite me, none o un id, y pagina', () => {
    const id = '11111111-1111-4111-8111-111111111111';
    expect(ConversationFilterSchema.parse({ assignee: 'me' }).assignee).toBe('me');
    expect(ConversationFilterSchema.parse({ assignee: 'none' }).assignee).toBe('none');
    expect(ConversationFilterSchema.parse({ assignee: id }).assignee).toBe(id);
    expect(ConversationFilterSchema.safeParse({ assignee: 'otro' }).success).toBe(false);
    expect(ConversationFilterSchema.parse({})).toMatchObject({ page: 1, limit: 30 });
    expect(ConversationFilterSchema.safeParse({ limit: 500 }).success).toBe(false);
  });

  it('la respuesta lleva texto; el asunto es opcional', () => {
    expect(ReplyConversationSchema.safeParse({ body: '  ' }).success).toBe(false);
    expect(ReplyConversationSchema.parse({ body: ' Hola ' }).body).toBe('Hola');
  });

  it('los vínculos exigen al menos un campo y aceptan null para desvincular', () => {
    const id = '11111111-1111-4111-8111-111111111111';
    expect(LinkConversationSchema.safeParse({}).success).toBe(false);
    expect(LinkConversationSchema.parse({ personId: null }).personId).toBeNull();
    expect(LinkConversationSchema.parse({ related: { type: 'Contract', id } }).related).toEqual({ type: 'Contract', id });
    expect(LinkConversationSchema.safeParse({ related: { type: 'Ticket', id } }).success).toBe(false);
  });

  it('registrar una llamada lleva nombre, teléfono y resumen; por defecto ya atendida', () => {
    expect(RegisterCallSchema.parse({ name: 'Iris', phone: '351 555-0101', summary: 'Pidió ver el depto' }).answered).toBe(true);
    expect(RegisterCallSchema.safeParse({ name: 'Iris', phone: '1', summary: 'x' }).success).toBe(false);
  });

  it('el mail entrante se valida y los automáticos se marcan', () => {
    const ok = { tenantSlug: 'demo', messageId: '<abc@mail>', from: 'iris@example.com', text: 'Hola' };
    expect(EmailIngestSchema.parse(ok).automatic).toBe(false);
    expect(EmailIngestSchema.parse({ ...ok, receivedAt: '2026-11-03T12:00:00Z' }).receivedAt).toEqual(new Date('2026-11-03T12:00:00Z'));
    expect(EmailIngestSchema.safeParse({ ...ok, extra: 1 }).success).toBe(false);
    expect(EmailIngestSchema.safeParse({ ...ok, messageId: '' }).success).toBe(false);
  });
});
