import { BillMailIngestSchema, EmailIngestSchema } from '@realfy/shared';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { verifyMetaSignature } from '../../../apps/api/src/modules/messaging/webhook-signatures';
import worker, { handleEmail } from './index';
import { buildMime, demoEnv, fakeMessage, PDF_BYTES, SECRET } from './fixtures';
import { MAX_ATTACHMENT_BYTES } from './mail';

const fetchMock = vi.fn<typeof fetch>();

function apiAnswers(status: number, json: object = { received: true }): void {
  fetchMock.mockResolvedValue(new Response(JSON.stringify(json), { status, headers: { 'content-type': 'application/json' } }));
}

function sent() {
  const [url, init] = fetchMock.mock.calls[0];
  const body = String(init?.body);
  const headers = init?.headers as Record<string, string>;
  return { url: String(url), body, json: JSON.parse(body), headers, method: init?.method };
}

beforeEach(() => {
  fetchMock.mockReset();
  vi.stubGlobal('fetch', fetchMock);
  vi.spyOn(console, 'log').mockImplementation(() => undefined);
  apiAnswers(200, { received: true, documents: [] });
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('boletas@', () => {
  const pdf = { filename: 'factura-abril.pdf', contentType: 'application/pdf', content: PDF_BYTES };

  it('CP-1412: manda la boleta con el PDF en base64 a /api/bills-intake/email-ingest, firmada', async () => {
    const message = fakeMessage(buildMime({ attachments: [pdf] }));
    await handleEmail(message, demoEnv());

    const call = sent();
    expect(call.url).toBe('https://api.demo.test/api/bills-intake/email-ingest');
    expect(call.method).toBe('POST');
    expect(call.headers['content-type']).toBe('application/json');
    // La firma pasa por la verificación real de la API, sobre los mismos bytes del cuerpo.
    expect(verifyMetaSignature(Buffer.from(call.body, 'utf8'), call.headers['X-Realfy-Signature'], SECRET)).toBe(true);

    const parsed = BillMailIngestSchema.parse(call.json);
    expect(parsed).toMatchObject({
      tenantSlug: 'demo',
      to: 'boletas+demo@realfy.app',
      messageId: '<demo-1@proveedor-demo.test>',
      from: 'facturas@proveedor-demo.test',
      subject: 'Factura de abril',
    });
    expect(parsed.automatic).toBe(false);
    expect(parsed.attachments).toHaveLength(1);
    expect(parsed.attachments[0]).toMatchObject({ filename: 'factura-abril.pdf', contentType: 'application/pdf' });
    expect(Buffer.from(parsed.attachments[0].contentBase64, 'base64').equals(PDF_BYTES)).toBe(true);
    expect(message.rejected).toEqual([]);
  });

  it('CP-1416: boletas@ sin slug usa DEFAULT_TENANT_SLUG', async () => {
    await handleEmail(fakeMessage(buildMime({ attachments: [pdf] }), 'boletas@realfy.app'), demoEnv({ DEFAULT_TENANT_SLUG: ' Demo ' }));
    expect(BillMailIngestSchema.parse(sent().json)).toMatchObject({ tenantSlug: 'demo', to: 'boletas@realfy.app' });
  });

  it('CP-1416: boletas@ sin slug y sin DEFAULT_TENANT_SLUG falla (queda para reintentar), sin llamar a la API', async () => {
    await expect(handleEmail(fakeMessage(buildMime(), 'boletas@realfy.app'), demoEnv())).rejects.toThrow(/DEFAULT_TENANT_SLUG/);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('CP-1416: el slug de la dirección gana sobre el de por defecto', async () => {
    await handleEmail(fakeMessage(buildMime(), 'boletas+otra@realfy.app'), demoEnv({ DEFAULT_TENANT_SLUG: 'demo' }));
    expect(sent().json.tenantSlug).toBe('otra');
  });

  it('CP-1418: manda sólo los PDF: ignora imágenes y otros adjuntos', async () => {
    const png = { filename: 'logo.png', contentType: 'image/png', content: Buffer.from('png-demo') };
    const octet = { filename: 'boleta.PDF', contentType: 'application/octet-stream', content: PDF_BYTES };
    await handleEmail(fakeMessage(buildMime({ attachments: [png, pdf, octet] })), demoEnv());
    const parsed = BillMailIngestSchema.parse(sent().json);
    expect(parsed.attachments.map((a) => a.filename)).toEqual(['factura-abril.pdf', 'boleta.PDF']);
  });

  it('CP-1418: sin adjuntos manda la lista vacía (la API lo deja en revisión)', async () => {
    await handleEmail(fakeMessage(buildMime()), demoEnv());
    expect(BillMailIngestSchema.parse(sent().json).attachments).toEqual([]);
  });

  it('CP-1419: respeta lo que acepta la API: salta el PDF de más de 10 MiB y pasa de 10 adjuntos', async () => {
    const big = { filename: 'enorme.pdf', contentType: 'application/pdf', content: Buffer.alloc(MAX_ATTACHMENT_BYTES + 1, 0x41) };
    const many = Array.from({ length: 11 }, (_, i) => ({ ...pdf, filename: `f${i}.pdf` }));
    await handleEmail(fakeMessage(buildMime({ attachments: [big, ...many] })), demoEnv());
    const parsed = BillMailIngestSchema.parse(sent().json);
    expect(parsed.attachments).toHaveLength(10);
    expect(parsed.attachments.map((a) => a.filename)).not.toContain('enorme.pdf');
  });

  it('CP-1419: un PDF de exactamente 10 MiB entra', async () => {
    const edge = { filename: 'justo.pdf', contentType: 'application/pdf', content: Buffer.alloc(MAX_ATTACHMENT_BYTES, 0x41) };
    await handleEmail(fakeMessage(buildMime({ attachments: [edge] })), demoEnv());
    expect(BillMailIngestSchema.parse(sent().json).attachments).toHaveLength(1);
  });

  it('CP-1419: el total en base64 queda por debajo del límite de cuerpo de la API (25 MiB)', async () => {
    const chunk = { filename: 'a.pdf', contentType: 'application/pdf', content: Buffer.alloc(8 * 1024 * 1024, 0x41) };
    await handleEmail(fakeMessage(buildMime({ attachments: [chunk, { ...chunk, filename: 'b.pdf' }, { ...chunk, filename: 'c.pdf' }] })), demoEnv());
    const { body, json } = sent();
    expect(Buffer.byteLength(body)).toBeLessThan(25 * 1024 * 1024);
    expect(json.attachments).toHaveLength(2);
  });

  it('CP-1417: un mail automático con PDF igual se manda, con automatic: true (la API lo acepta y no lo descarta)', async () => {
    await handleEmail(fakeMessage(buildMime({ from: 'no-reply@proveedor-demo.test', attachments: [pdf], headers: { 'Auto-Submitted': 'auto-generated' } })), demoEnv());
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const parsed = BillMailIngestSchema.parse(sent().json);
    expect(parsed).toMatchObject({ automatic: true, from: 'no-reply@proveedor-demo.test' });
    expect(parsed.attachments).toHaveLength(1);
  });
});

describe('consultas@', () => {
  it('CP-1415: manda la consulta a /api/inbox/email-ingest con el cuerpo de la bandeja', async () => {
    const message = fakeMessage(
      buildMime({ from: 'Ana Prueba <ana@clientes-demo.test>', to: 'consultas+demo@realfy.app', subject: 'Consulta por el depto', messageId: '<q-1@clientes-demo.test>', text: 'Hola, ¿sigue disponible?' }),
      'consultas+demo@realfy.app',
      'ana@clientes-demo.test',
    );
    await handleEmail(message, demoEnv());

    const call = sent();
    expect(call.url).toBe('https://api.demo.test/api/inbox/email-ingest');
    expect(verifyMetaSignature(Buffer.from(call.body, 'utf8'), call.headers['X-Realfy-Signature'], SECRET)).toBe(true);
    expect(EmailIngestSchema.parse(call.json)).toMatchObject({
      tenantSlug: 'demo',
      messageId: '<q-1@clientes-demo.test>',
      from: 'ana@clientes-demo.test',
      fromName: 'Ana Prueba',
      subject: 'Consulta por el depto',
      automatic: false,
    });
    expect(call.json.text).toContain('¿sigue disponible?');
    expect(call.json.text.length).toBeLessThanOrEqual(20000);
    expect(new Date(call.json.receivedAt).getTime()).not.toBeNaN();
  });

  it('CP-1416: consultas@ sin slug usa DEFAULT_TENANT_SLUG', async () => {
    await handleEmail(fakeMessage(buildMime(), 'consultas@realfy.app'), demoEnv({ DEFAULT_TENANT_SLUG: 'demo' }));
    expect(sent().json.tenantSlug).toBe('demo');
  });

  it('CP-1421: un mail sólo HTML llega como texto plano', async () => {
    await handleEmail(
      fakeMessage(buildMime({ html: '<style>p{color:red}</style><p>Hola <b>equipo</b></p><p>Quiero visitar</p>' }), 'consultas+demo@realfy.app'),
      demoEnv(),
    );
    const { text } = sent().json;
    expect(text).toContain('Hola');
    expect(text).toContain('Quiero visitar');
    expect(text).not.toMatch(/<|color:red/);
  });

  it('CP-1421: un texto larguísimo se corta a lo que acepta el esquema', async () => {
    await handleEmail(fakeMessage(buildMime({ text: 'x'.repeat(50_000) }), 'consultas+demo@realfy.app'), demoEnv());
    expect(EmailIngestSchema.parse(sent().json).text).toHaveLength(20000);
  });

  it('CP-1420: sin Message-ID usa un identificador derivado del contenido, igual en el reintento', async () => {
    const mime = buildMime({ messageId: null });
    await handleEmail(fakeMessage(mime, 'consultas+demo@realfy.app'), demoEnv());
    const first = sent().json.messageId;
    fetchMock.mockClear();
    await handleEmail(fakeMessage(mime, 'consultas+demo@realfy.app'), demoEnv());
    expect(first).toMatch(/^<sha256-[0-9a-f]{64}@email-worker\.invalid>$/);
    expect(sent().json.messageId).toBe(first);
  });

  it('CP-1420: sin remitente en el encabezado usa el del sobre', async () => {
    const mime = buildMime().replace(/^From: .*\r\n/, '');
    await handleEmail(fakeMessage(mime, 'consultas+demo@realfy.app', 'sobre@origen-demo.test'), demoEnv());
    expect(sent().json.from).toBe('sobre@origen-demo.test');
  });

  it.each([
    ['Auto-Submitted', 'auto-replied', true],
    ['Auto-Submitted', 'auto-generated', true],
    ['Auto-Submitted', 'no', false],
    ['Precedence', 'bulk', true],
    ['Precedence', 'auto_reply', true],
    ['Precedence', 'list', false],
  ])('CP-1417: %s: %s -> automatic=%s', async (name, value, automatic) => {
    await handleEmail(fakeMessage(buildMime({ headers: { [name]: value } }), 'consultas+demo@realfy.app'), demoEnv());
    expect(sent().json.automatic).toBe(automatic);
  });

  it('CP-1417: un mail común no es automático', async () => {
    await handleEmail(fakeMessage(buildMime(), 'consultas+demo@realfy.app'), demoEnv());
    expect(sent().json.automatic).toBe(false);
  });
});

describe('otro destinatario', () => {
  it('CP-1411: se rechaza con un error permanente y no se llama a la API', async () => {
    const message = fakeMessage(buildMime({ to: 'info@realfy.app' }), 'info@realfy.app');
    await handleEmail(message, demoEnv());
    expect(message.rejected).toEqual(['Unknown recipient']);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('CP-1411: con FALLBACK_FORWARD_TO se reenvía a esa dirección', async () => {
    const message = fakeMessage(buildMime({ to: 'info@realfy.app' }), 'info@realfy.app');
    await handleEmail(message, demoEnv({ FALLBACK_FORWARD_TO: ' equipo@demo.test ' }));
    expect(message.forwarded).toEqual(['equipo@demo.test']);
    expect(message.rejected).toEqual([]);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe('respuestas de la API', () => {
  const run = (to = 'consultas+demo@realfy.app', env = demoEnv()) => {
    const message = fakeMessage(buildMime({ to }), to);
    return { message, done: handleEmail(message, env) };
  };

  it.each([500, 502, 503, 504])('CP-1422: %i: lanza para que Cloudflare reintente, sin rechazar', async (status) => {
    apiAnswers(status, { error: 'x' });
    const { message, done } = run();
    await expect(done).rejects.toThrow(String(status));
    expect(message.rejected).toEqual([]);
    expect(message.forwarded).toEqual([]);
  });

  it.each([401, 403, 408, 425, 429])('CP-1423: %i (firma, configuración o momento): también se reintenta', async (status) => {
    apiAnswers(status, { error: 'x' });
    await expect(run().done).rejects.toThrow(String(status));
  });

  it('CP-1424: 400 se registra y no se reintenta: se rechaza', async () => {
    apiAnswers(400, { error: 'VALIDATION_ERROR' });
    const { message, done } = run();
    await expect(done).resolves.toBeUndefined();
    expect(message.rejected).toEqual(['Message could not be processed']);
    expect(console.log).toHaveBeenCalledWith(expect.stringContaining('"api-rejected"'));
  });

  it('CP-1424: 404 (inmobiliaria desconocida) se rechaza como destinatario desconocido', async () => {
    apiAnswers(404, { error: 'TENANT_NOT_FOUND' });
    const { message, done } = run('boletas+nadie@realfy.app');
    await expect(done).resolves.toBeUndefined();
    expect(message.rejected).toEqual(['Unknown recipient']);
  });

  it('CP-1424: un 4xx con FALLBACK_FORWARD_TO reenvía a una persona en lugar de rechazar', async () => {
    apiAnswers(422, { error: 'x' });
    const { message, done } = run('consultas+demo@realfy.app', demoEnv({ FALLBACK_FORWARD_TO: 'equipo@demo.test' }));
    await done;
    expect(message.forwarded).toEqual(['equipo@demo.test']);
    expect(message.rejected).toEqual([]);
  });

  it('CP-1425: el 200 con ignored (automático) no rechaza ni reenvía', async () => {
    apiAnswers(200, { received: true, ignored: 'automatic' });
    const { message, done } = run();
    await expect(done).resolves.toBeUndefined();
    expect(message.rejected).toEqual([]);
    expect(console.log).toHaveBeenCalledWith(expect.stringContaining('"ignored":"automatic"'));
  });

  it('CP-1425: un 200 con cuerpo que no es JSON no es un error', async () => {
    fetchMock.mockResolvedValue(new Response('ok', { status: 200 }));
    await expect(run().done).resolves.toBeUndefined();
  });

  it('CP-1422: un error de red lanza (se reintenta)', async () => {
    fetchMock.mockRejectedValue(new TypeError('fetch failed'));
    await expect(run().done).rejects.toThrow(/retry later/);
  });

  it('CP-1426: sin secreto o sin API_BASE_URL lanza y no llama a la API', async () => {
    await expect(run('consultas+demo@realfy.app', demoEnv({ INBOX_EMAIL_INGEST_SECRET: '' })).done).rejects.toThrow(/misconfigured/);
    await expect(run('consultas+demo@realfy.app', demoEnv({ API_BASE_URL: '' })).done).rejects.toThrow(/misconfigured/);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('CP-1426: API_BASE_URL con barra final no duplica la barra', async () => {
    await run('consultas+demo@realfy.app', demoEnv({ API_BASE_URL: 'https://api.demo.test//' })).done;
    expect(sent().url).toBe('https://api.demo.test/api/inbox/email-ingest');
  });

  it('CP-1427: un mensaje ilegible se rechaza y no se llama a la API', async () => {
    const broken = new ReadableStream<Uint8Array>({ start: (controller) => controller.error(new Error('stream roto')) });
    const message = fakeMessage(broken, 'consultas+demo@realfy.app');
    await handleEmail(message, demoEnv());
    expect(message.rejected).toEqual(['Message could not be read']);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe('export del Worker', () => {
  it('CP-1412: el handler email(message, env, ctx) delega en handleEmail', async () => {
    await worker.email(fakeMessage(buildMime()), demoEnv(), {});
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
