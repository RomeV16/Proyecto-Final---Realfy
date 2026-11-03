import { billsPayload, inboxPayload, readMail, type ParsedMail } from './mail';
import { parseRecipient } from './recipient';
import { SIGNATURE_HEADER, signBody } from './signature';
import type { Env, InboundEmail } from './types';

const REQUEST_TIMEOUT_MS = 20_000;
/** 4xx que no son del mail sino del momento o de la configuración: se reintentan como un 5xx. */
const RETRYABLE_CLIENT_ERRORS = new Set([401, 403, 408, 425, 429]);

const ENDPOINTS = { bills: '/api/bills-intake/email-ingest', inbox: '/api/inbox/email-ingest' } as const;

function log(event: string, fields: Record<string, unknown> = {}): void {
  console.log(JSON.stringify({ event, ...fields }));
}

/** Lo que no se puede procesar: se reenvía a una persona si hay dirección, y si no se rechaza con un error permanente. */
async function setAside(message: InboundEmail, env: Env, reason: string): Promise<void> {
  const fallback = env.FALLBACK_FORWARD_TO?.trim();
  if (fallback) {
    await message.forward(fallback);
    log('forwarded-to-fallback', { reason });
    return;
  }
  message.setReject(reason);
  log('rejected', { reason });
}

async function post(env: Env, path: string, payload: object): Promise<Response> {
  const secret = env.INBOX_EMAIL_INGEST_SECRET;
  const base = env.API_BASE_URL?.trim().replace(/\/+$/, '');
  if (!secret || !base) throw new Error('email worker misconfigured: API_BASE_URL and INBOX_EMAIL_INGEST_SECRET are required');
  const body = JSON.stringify(payload);
  try {
    return await fetch(`${base}${path}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', [SIGNATURE_HEADER]: await signBody(secret, body) },
      body,
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
  } catch (error) {
    log('api-unreachable', { path, error: error instanceof Error ? error.name : 'unknown' });
    throw new Error('API unreachable, retry later', { cause: error });
  }
}

async function ignoredReason(response: Response): Promise<string | undefined> {
  try {
    const json = (await response.json()) as { ignored?: unknown };
    return typeof json.ignored === 'string' ? json.ignored : undefined;
  } catch {
    return undefined;
  }
}

/** 2xx: listo. 5xx y errores de momento o de configuración: `throw` (Cloudflare lo trata como falla temporal). Otro 4xx: no se reintenta. */
async function handleResponse(message: InboundEmail, env: Env, kind: string, response: Response): Promise<void> {
  if (response.ok) {
    log('delivered', { kind, status: response.status, ignored: await ignoredReason(response) });
    return;
  }
  const status = response.status;
  await response.body?.cancel();
  if (status >= 500 || RETRYABLE_CLIENT_ERRORS.has(status)) {
    log('api-error-retry', { kind, status });
    throw new Error(`API responded ${status}, retry later`);
  }
  log('api-rejected', { kind, status });
  await setAside(message, env, status === 404 ? 'Unknown recipient' : 'Message could not be processed');
}

function describe(mail: ParsedMail) {
  return { automatic: mail.automatic, pdfs: mail.pdfs.length, skippedPdfs: mail.skippedPdfs };
}

export async function handleEmail(message: InboundEmail, env: Env): Promise<void> {
  const route = parseRecipient(message.to);
  if (!route) {
    await setAside(message, env, 'Unknown recipient');
    return;
  }
  const slug = route.slug ?? (env.DEFAULT_TENANT_SLUG?.trim().toLowerCase() || null);
  if (!slug) throw new Error('email worker misconfigured: the address has no +<slug> and DEFAULT_TENANT_SLUG is empty');

  let mail: ParsedMail;
  try {
    mail = await readMail(message);
  } catch (error) {
    log('unreadable-mime', { kind: route.kind, error: error instanceof Error ? error.name : 'unknown' });
    await setAside(message, env, 'Message could not be read');
    return;
  }
  log('received', { kind: route.kind, ...describe(mail) });

  const receivedAt = new Date();
  const payload =
    route.kind === 'bills'
      ? billsPayload(mail, message.to.trim().toLowerCase(), slug, receivedAt)
      : inboxPayload(mail, slug, receivedAt);
  const response = await post(env, ENDPOINTS[route.kind], payload);
  await handleResponse(message, env, route.kind, response);
}

export default {
  async email(message: InboundEmail, env: Env, _ctx?: unknown): Promise<void> {
    await handleEmail(message, env);
  },
};
