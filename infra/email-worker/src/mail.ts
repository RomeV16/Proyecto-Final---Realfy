import PostalMime, { type Email } from 'postal-mime';
import type { InboundEmail } from './types';

/** Límites de la API: 10 adjuntos de hasta 10 MiB y cuerpo JSON de hasta 25 MiB (`main.ts`, `BillMailIngestSchema`). */
const MAX_ATTACHMENTS = 10;
export const MAX_ATTACHMENT_BYTES = 10 * 1024 * 1024;
const MAX_TOTAL_BASE64_BYTES = 24 * 1024 * 1024;
const TEXT_MAX = 20000;

export interface PdfAttachment {
  filename: string;
  contentBase64: string;
}

export interface ParsedMail {
  messageId: string;
  from: string;
  fromName: string | undefined;
  subject: string | undefined;
  text: string;
  automatic: boolean;
  pdfs: PdfAttachment[];
  /** Adjuntos PDF que no entran en lo que acepta la API (cantidad, tamaño). */
  skippedPdfs: number;
}

function header(email: Email, name: string): string | undefined {
  return email.headers.find((h) => h.key === name)?.value.trim().toLowerCase();
}

/**
 * Misma regla que documenta la API para el reenvío: `Auto-Submitted` distinto de `no`, o
 * `Precedence: bulk` / `auto_reply`. (Los remitentes `no-reply@`, `mailer-daemon@`, etc. los filtra la API.)
 */
function isAutomatic(email: Email): boolean {
  const autoSubmitted = header(email, 'auto-submitted');
  if (autoSubmitted !== undefined && autoSubmitted !== 'no') return true;
  const precedence = header(email, 'precedence');
  return precedence === 'bulk' || precedence === 'auto_reply';
}

function textOf(email: Email): string {
  if (email.text?.trim()) return email.text;
  return (email.html ?? '')
    .replace(/<(style|script)[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/[ \t]+/g, ' ')
    .trim();
}

function decodedBytes(base64: string): number {
  const padding = base64.endsWith('==') ? 2 : base64.endsWith('=') ? 1 : 0;
  return Math.floor((base64.length * 3) / 4) - padding;
}

function isPdfPart(mimeType: string, filename: string | null): boolean {
  return mimeType === 'application/pdf' || /\.pdf$/i.test(filename ?? '');
}

async function sha256Hex(bytes: ArrayBuffer): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('');
}

/** Lee y normaliza el mail. Lanza si el MIME no se puede interpretar. */
export async function readMail(message: InboundEmail): Promise<ParsedMail> {
  const raw = await new Response(message.raw).arrayBuffer();
  const email = await PostalMime.parse(raw, { attachmentEncoding: 'base64' });

  const pdfs: PdfAttachment[] = [];
  let skippedPdfs = 0;
  let totalBase64 = 0;
  for (const part of email.attachments) {
    if (!isPdfPart(part.mimeType, part.filename) || typeof part.content !== 'string') continue;
    const fits =
      pdfs.length < MAX_ATTACHMENTS &&
      part.content.length > 0 &&
      decodedBytes(part.content) <= MAX_ATTACHMENT_BYTES &&
      totalBase64 + part.content.length <= MAX_TOTAL_BASE64_BYTES;
    if (!fits) {
      skippedPdfs += 1;
      continue;
    }
    totalBase64 += part.content.length;
    pdfs.push({ filename: (part.filename ?? 'boleta.pdf').slice(0, 300), contentBase64: part.content });
  }

  const sender = email.from?.address ? email.from : undefined;
  return {
    // Sin Message-ID se usa el hash del mensaje: el reintento del mismo mail lleva el mismo identificador.
    messageId: (email.messageId?.trim() || `<sha256-${await sha256Hex(raw)}@email-worker.invalid>`).slice(0, 500),
    from: (sender?.address ?? message.from).slice(0, 320),
    fromName: sender?.name ? sender.name.slice(0, 200) : undefined,
    subject: email.subject?.slice(0, 300),
    text: textOf(email).slice(0, TEXT_MAX),
    automatic: isAutomatic(email),
    pdfs,
    skippedPdfs,
  };
}

/** Cuerpo de `POST /api/inbox/email-ingest` (`EmailIngestSchema`). */
export function inboxPayload(mail: ParsedMail, tenantSlug: string, receivedAt: Date) {
  return {
    tenantSlug,
    messageId: mail.messageId,
    from: mail.from,
    ...(mail.fromName ? { fromName: mail.fromName } : {}),
    ...(mail.subject ? { subject: mail.subject } : {}),
    text: mail.text,
    receivedAt: receivedAt.toISOString(),
    automatic: mail.automatic,
  };
}

/** Cuerpo de `POST /api/bills-intake/email-ingest` (`BillMailIngestSchema`). */
export function billsPayload(mail: ParsedMail, to: string, tenantSlug: string, receivedAt: Date) {
  return {
    tenantSlug,
    to,
    messageId: mail.messageId,
    from: mail.from,
    ...(mail.subject ? { subject: mail.subject } : {}),
    receivedAt: receivedAt.toISOString(),
    attachments: mail.pdfs.map((pdf) => ({ filename: pdf.filename, contentType: 'application/pdf', contentBase64: pdf.contentBase64 })),
  };
}
