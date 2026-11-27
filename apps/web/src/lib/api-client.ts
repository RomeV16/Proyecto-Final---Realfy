import { createApiClient, ApiRequestError, type BlobResult } from './create-api-client';

export { ApiRequestError };
export type { ApiClientConfig, BlobResult } from './create-api-client';

export const API_BASE_URL =
  process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001/api';

export interface ApiError {
  error: string;
  message: string;
  statusCode: number;
}

// ── Auth helpers for UI state (user info only, no tokens) ──

export function getStoredUser(): { id: string; email: string; firstName: string; lastName: string; role: string; tenantId: string } | null {
  if (typeof window === 'undefined') return null;
  try {
    const stored = localStorage.getItem('user');
    const parsed: unknown = stored ? JSON.parse(stored) : null;
    if (!parsed || typeof parsed !== 'object') return null;
    const u = parsed as Record<string, unknown>;
    // Un valor a medias (otra versión, edición manual) se trata como si no hubiera usuario.
    if (typeof u.id !== 'string' || typeof u.role !== 'string') return null;
    const text = (value: unknown) => (typeof value === 'string' ? value : '');
    return {
      id: u.id,
      role: u.role,
      email: text(u.email),
      firstName: text(u.firstName),
      lastName: text(u.lastName),
      tenantId: text(u.tenantId),
    };
  } catch {
    return null;
  }
}

/**
 * Destino interno al que volver después de ingresar, tomado de `?redirect=`.
 * Solo acepta rutas propias de la web y nunca las de autenticación.
 */
export function safeRedirectTarget(search: string): string | null {
  const target = new URLSearchParams(search).get('redirect');
  if (!target || !target.startsWith('/') || target.startsWith('//') || target.includes('\\')) return null;
  if (/^\/(?:[a-z]{2}(?:-[A-Z]{2})?\/)?auth(?:\/|$)/.test(target)) return null;
  return target;
}

export function setStoredUser(user: { id: string; email: string; firstName: string; lastName: string; role: string; tenantId: string }) {
  if (typeof window !== 'undefined') {
    localStorage.setItem('user', JSON.stringify(user));
  }
}

export function clearStoredUser() {
  if (typeof window !== 'undefined') {
    localStorage.removeItem('user');
  }
}

// ── Cliente del personal: sesión por cookies httpOnly + renovación automática ──

const staffClient = createApiClient({
  baseUrl: API_BASE_URL,
  credentials: 'include',
  loginPath: '/auth/login',
  refresh: async () => {
    try {
      const res = await fetch(`${API_BASE_URL}/auth/refresh`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include', // envía la cookie refresh_token
      });
      return res.ok;
    } catch {
      return false;
    }
  },
  onUnauthorized: clearStoredUser,
});

export function apiClient<T = unknown>(path: string, options: RequestInit = {}): Promise<T> {
  return staffClient.request<T>(path, options);
}

/** Descarga binaria (PDF, planillas) con la misma sesión que `apiClient`. */
export function apiBlob(path: string, options: RequestInit = {}): Promise<BlobResult> {
  return staffClient.blob(path, options);
}
