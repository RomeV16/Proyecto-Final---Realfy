import type { Env, InboundEmail } from './types';

/** PDF mínimo y sintético: alcanza para la firma `%PDF-` que la API exige. */
export const PDF_BYTES = Buffer.from('%PDF-1.4\n1 0 obj<</Type/Catalog>>endobj\ntrailer<</Root 1 0 R>>\n%%EOF\n', 'utf8');

export interface MimeAttachment {
  filename: string;
  contentType: string;
  content: Buffer;
}

export interface MimeOptions {
  from?: string;
  to?: string;
  subject?: string;
  messageId?: string | null;
  headers?: Record<string, string>;
  text?: string;
  html?: string;
  attachments?: MimeAttachment[];
}

const CRLF = '\r\n';

function wrap76(base64: string): string {
  return base64.replace(/(.{76})/g, `$1${CRLF}`);
}

/** Arma un mail MIME multipart/mixed (o de una sola parte si no hay adjuntos). */
export function buildMime(options: MimeOptions = {}): string {
  const { from = 'Proveedor Demo <facturas@proveedor-demo.test>', to = 'boletas+demo@realfy.app', subject = 'Factura de abril', text = 'Adjuntamos la factura del mes.', html, attachments = [] } = options;
  const lines = [`From: ${from}`, `To: ${to}`, `Subject: ${subject}`, 'Date: Tue, 03 Nov 2026 10:00:00 -0300', 'MIME-Version: 1.0'];
  if (options.messageId !== null) lines.push(`Message-ID: ${options.messageId ?? '<demo-1@proveedor-demo.test>'}`);
  for (const [key, value] of Object.entries(options.headers ?? {})) lines.push(`${key}: ${value}`);

  const body = (textBody: string) =>
    html
      ? [`Content-Type: text/html; charset=utf-8`, '', html]
      : [`Content-Type: text/plain; charset=utf-8`, 'Content-Transfer-Encoding: 7bit', '', textBody];

  if (attachments.length === 0) return [...lines, ...body(text), ''].join(CRLF);

  const boundary = '----demo-boundary-1';
  const parts = [
    `--${boundary}`,
    ...body(text),
    ...attachments.flatMap((a) => [
      `--${boundary}`,
      `Content-Type: ${a.contentType}; name="${a.filename}"`,
      'Content-Transfer-Encoding: base64',
      `Content-Disposition: attachment; filename="${a.filename}"`,
      '',
      wrap76(a.content.toString('base64')),
    ]),
    `--${boundary}--`,
    '',
  ];
  return [...lines, `Content-Type: multipart/mixed; boundary="${boundary}"`, '', ...parts].join(CRLF);
}

export interface FakeMessage extends InboundEmail {
  rejected: string[];
  forwarded: string[];
}

export function fakeMessage(mime: string | ReadableStream<Uint8Array>, to = 'boletas+demo@realfy.app', from = 'facturas@proveedor-demo.test'): FakeMessage {
  const rejected: string[] = [];
  const forwarded: string[] = [];
  const raw = typeof mime === 'string' ? new Blob([mime]).stream() : mime;
  return {
    from,
    to,
    raw,
    rawSize: typeof mime === 'string' ? mime.length : 0,
    rejected,
    forwarded,
    setReject: (reason) => void rejected.push(reason),
    forward: async (rcptTo) => void forwarded.push(rcptTo),
  };
}

export const SECRET = 'demo-ingest-secret';

export function demoEnv(overrides: Partial<Env> = {}): Env {
  return { API_BASE_URL: 'https://api.demo.test', INBOX_EMAIL_INGEST_SECRET: SECRET, DEFAULT_TENANT_SLUG: '', ...overrides };
}
