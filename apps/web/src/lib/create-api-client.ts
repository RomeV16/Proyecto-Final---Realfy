import { localizedPath } from '@/i18n/locale-path';

/** Campos del cuerpo de error que ya tienen lugar propio en `ApiRequestError`. */
const ENVELOPE_FIELDS = new Set([
  'statusCode',
  'message',
  'error',
  'errorCode',
  'correlationId',
  'timestamp',
]);

/**
 * Error normalizado de la API. Lo lanzan todos los clientes (staff y portal).
 * `details` trae el contexto que agrega el servicio (por ejemplo `problems` o
 * `validTransitions`) sin los campos del envoltorio.
 */
export class ApiRequestError extends Error {
  readonly details: Record<string, unknown>;
  readonly correlationId?: string;

  constructor(
    public status: number,
    public errorCode: string,
    message: string,
    /** Cuerpo completo de la respuesta, tal como lo devolvió la API. */
    public body?: Record<string, unknown>,
    correlationId?: string,
  ) {
    super(message);
    this.name = 'ApiRequestError';
    const fromBody =
      typeof body?.correlationId === 'string' ? body.correlationId : undefined;
    this.correlationId = correlationId ?? fromBody;
    this.details = Object.fromEntries(
      Object.entries(body ?? {}).filter(([key]) => !ENVELOPE_FIELDS.has(key)),
    );
  }

  /** Nombre histórico de `status`; los puntos de uso existentes lo leen así. */
  get statusCode(): number {
    return this.status;
  }
}

export interface ApiClientConfig {
  baseUrl: string;
  /** Token Bearer a enviar. Sin token (staff) la sesión viaja en cookies. */
  getToken?: () => string | null;
  /** `include` para sesiones por cookie httpOnly. */
  credentials?: RequestCredentials;
  /** Renueva la sesión. Devuelve `true` si se pudo y conviene reintentar. */
  refresh?: () => Promise<boolean>;
  /** Limpia la sesión local cuando la renovación falla. */
  onUnauthorized?: () => void;
  /** Ruta de login (sin locale) a la que se redirige al perder la sesión. */
  loginPath: string;
}

export interface BlobResult {
  blob: Blob;
  /** Nombre sugerido por `Content-Disposition`, si lo trae. */
  filename: string | null;
}

/** Extrae el nombre de archivo de un `Content-Disposition`. */
export function filenameFromDisposition(header: string | null): string | null {
  if (!header) return null;
  const star = /filename\*=(?:UTF-8'')?([^;]+)/i.exec(header);
  if (star) {
    try {
      return decodeURIComponent(star[1].trim().replace(/^"|"$/g, ''));
    } catch {
      // cae al nombre simple
    }
  }
  const plain = /filename="?([^";]+)"?/i.exec(header);
  return plain ? plain[1].trim() : null;
}

async function toError(response: Response): Promise<ApiRequestError> {
  const headerId = response.headers.get('x-request-id') ?? undefined;
  let body: (Record<string, unknown> & { error?: string; message?: unknown }) | null = null;
  try {
    body = await response.json();
  } catch {
    body = null;
  }
  if (!body || typeof body !== 'object') {
    return new ApiRequestError(
      response.status,
      'UNKNOWN_ERROR',
      response.statusText,
      undefined,
      headerId,
    );
  }
  const message = Array.isArray(body.message)
    ? body.message.join(', ')
    : (body.message as string | undefined);
  return new ApiRequestError(
    response.status,
    body.error || 'UNKNOWN_ERROR',
    message || response.statusText,
    body,
    typeof body.correlationId === 'string' ? body.correlationId : headerId,
  );
}

export function createApiClient(config: ApiClientConfig) {
  const { baseUrl, getToken, credentials, refresh, onUnauthorized, loginPath } = config;
  let refreshPromise: Promise<boolean> | null = null;

  // Los intentos concurrentes de renovar comparten una sola llamada.
  const attemptRefresh = (): Promise<boolean> => {
    if (!refresh) return Promise.resolve(false);
    if (!refreshPromise) {
      refreshPromise = refresh()
        .catch(() => false)
        .finally(() => {
          refreshPromise = null;
        });
    }
    return refreshPromise;
  };

  const send = (path: string, options: RequestInit) => {
    const headers: Record<string, string> = {
      ...((options.headers as Record<string, string>) || {}),
    };
    // El Content-Type se fija solo para cuerpos JSON (no FormData).
    if (!options.body || typeof options.body === 'string') {
      headers['Content-Type'] = headers['Content-Type'] || 'application/json';
    }
    const token = getToken?.();
    if (token) headers['Authorization'] = `Bearer ${token}`;
    return fetch(`${baseUrl}${path}`, {
      ...options,
      headers,
      ...(credentials ? { credentials } : {}),
    });
  };

  async function execute(path: string, options: RequestInit): Promise<Response> {
    let response = await send(path, options);

    // Ante un 401 se renueva la sesión y se reintenta una sola vez.
    if (response.status === 401) {
      if (await attemptRefresh()) {
        response = await send(path, options);
      } else {
        onUnauthorized?.();
        if (typeof window !== 'undefined') {
          window.location.href = localizedPath(loginPath);
        }
        throw new ApiRequestError(401, 'UNAUTHORIZED', 'Session expired');
      }
    }

    if (!response.ok) throw await toError(response);
    return response;
  }

  async function request<T = unknown>(path: string, options: RequestInit = {}): Promise<T> {
    const response = await execute(path, options);
    if (response.status === 204) return undefined as T;
    return response.json();
  }

  /** Respuestas binarias (PDF, planillas): mismo manejo de sesión y de errores. */
  async function blob(path: string, options: RequestInit = {}): Promise<BlobResult> {
    const response = await execute(path, options);
    return {
      blob: await response.blob(),
      filename: filenameFromDisposition(response.headers.get('Content-Disposition')),
    };
  }

  return { request, blob };
}
