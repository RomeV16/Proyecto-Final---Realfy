const API_BASE_URL =
  process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001/api';

let portalAccessTokenMem: string | null = null;

// Token management — stored in memory + localStorage for persistence
export function getPortalAccessToken(): string | null {
  if (portalAccessTokenMem) return portalAccessTokenMem;
  if (typeof window !== 'undefined') {
    portalAccessTokenMem = localStorage.getItem('portalAccessToken');
  }
  return portalAccessTokenMem;
}

export function getPortalRefreshToken(): string | null {
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

// Refresh token flow — deduplicate concurrent attempts
let refreshPromise: Promise<boolean> | null = null;

async function attemptPortalRefresh(): Promise<boolean> {
  const refreshToken = getPortalRefreshToken();
  if (!refreshToken) return false;

  if (refreshPromise) return refreshPromise;

  refreshPromise = (async () => {
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
    } finally {
      refreshPromise = null;
    }
  })();

  return refreshPromise;
}

export interface PortalApiError {
  error: string;
  message: string;
  statusCode: number;
}

export class PortalApiRequestError extends Error {
  constructor(
    public statusCode: number,
    public errorCode: string,
    message: string,
  ) {
    super(message);
    this.name = 'PortalApiRequestError';
  }
}

// Core fetch wrapper with automatic token refresh
export async function portalApiClient<T = unknown>(
  path: string,
  options: RequestInit = {},
): Promise<T> {
  const url = `${API_BASE_URL}${path}`;

  const makeRequest = (token: string | null) => {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      ...((options.headers as Record<string, string>) || {}),
    };

    if (token) {
      headers['Authorization'] = `Bearer ${token}`;
    }

    return fetch(url, {
      ...options,
      headers,
    });
  };

  let response = await makeRequest(getPortalAccessToken());

  // On 401, try token refresh then retry once
  if (response.status === 401) {
    const refreshed = await attemptPortalRefresh();
    if (refreshed) {
      response = await makeRequest(getPortalAccessToken());
    } else {
      clearPortalTokens();
      if (typeof window !== 'undefined') {
        window.location.href = '/es/portal/auth/login';
      }
      throw new PortalApiRequestError(401, 'UNAUTHORIZED', 'Session expired');
    }
  }

  if (!response.ok) {
    let body: PortalApiError;
    try {
      body = await response.json();
    } catch {
      throw new PortalApiRequestError(
        response.status,
        'UNKNOWN_ERROR',
        response.statusText,
      );
    }
    throw new PortalApiRequestError(
      response.status,
      body.error || 'UNKNOWN_ERROR',
      body.message || response.statusText,
    );
  }

  // Handle 204 No Content
  if (response.status === 204) {
    return undefined as T;
  }

  return response.json();
}
