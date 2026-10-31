import { API_BASE_URL } from './api-client';
import { ApiRequestError, createApiClient, type BlobResult } from './create-api-client';

let portalAccessTokenMem: string | null = null;

// Token management — stored in memory + localStorage for persistence
export function getPortalAccessToken(): string | null {
  if (portalAccessTokenMem) return portalAccessTokenMem;
  if (typeof window !== 'undefined') {
    portalAccessTokenMem = localStorage.getItem('portalAccessToken');
  }
  return portalAccessTokenMem;
}

function getPortalRefreshToken(): string | null {
  if (typeof window !== 'undefined') {
    return localStorage.getItem('portalRefreshToken');
  }
  return null;
}

export function setPortalTokens(access: string, refresh: string) {
  portalAccessTokenMem = access;
  if (typeof window !== 'undefined') {
    localStorage.setItem('portalAccessToken', access);
    localStorage.setItem('portalRefreshToken', refresh);
    document.cookie = `portalAccessToken=${access}; path=/; max-age=${15 * 60}; SameSite=Lax`;
  }
}

export function clearPortalTokens() {
  portalAccessTokenMem = null;
  if (typeof window !== 'undefined') {
    localStorage.removeItem('portalAccessToken');
    localStorage.removeItem('portalRefreshToken');
    localStorage.removeItem('portalPerson');
    document.cookie = 'portalAccessToken=; path=/; max-age=0';
  }
}

/** El portal usa el mismo error normalizado que el personal. */
export { ApiRequestError as PortalApiRequestError };

export interface PortalApiError {
  error: string;
  message: string;
  statusCode: number;
}

// Renovación con el refresh token guardado; los intentos concurrentes se unifican en el cliente base.
async function refreshPortalSession(): Promise<boolean> {
  const refreshToken = getPortalRefreshToken();
  if (!refreshToken) return false;
  try {
    const res = await fetch(`${API_BASE_URL}/portal/auth/refresh`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ refreshToken }),
    });
    if (!res.ok) return false;
    const data = await res.json();
    setPortalTokens(data.tokens.accessToken, data.tokens.refreshToken);
    return true;
  } catch {
    return false;
  }
}

const portalClient = createApiClient({
  baseUrl: API_BASE_URL,
  getToken: getPortalAccessToken,
  loginPath: '/portal/auth/login',
  refresh: refreshPortalSession,
  onUnauthorized: clearPortalTokens,
});

export function portalApiClient<T = unknown>(path: string, options: RequestInit = {}): Promise<T> {
  return portalClient.request<T>(path, options);
}

/** Descarga binaria autenticada con el token del portal. */
export function portalApiBlob(path: string, options: RequestInit = {}): Promise<BlobResult> {
  return portalClient.blob(path, options);
}
