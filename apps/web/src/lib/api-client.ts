const API_BASE_URL =
  process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001/api';

// ── Error types ──

export interface ApiError {
  error: string;
  message: string;
  statusCode: number;
}

export class ApiRequestError extends Error {
  constructor(
    public statusCode: number,
    public errorCode: string,
    message: string,
  ) {
    super(message);
    this.name = 'ApiRequestError';
  }
}

// ── Refresh flow ──

let refreshPromise: Promise<boolean> | null = null;

async function attemptRefresh(): Promise<boolean> {
  // Deduplicate concurrent refresh attempts
  if (refreshPromise) return refreshPromise;

  refreshPromise = (async () => {
    try {
      const res = await fetch(`${API_BASE_URL}/auth/refresh`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include', // sends refresh_token cookie
      });
      return res.ok;
    } catch {
      return false;
    } finally {
      refreshPromise = null;
    }
  })();

  return refreshPromise;
}

// ── Auth helpers for UI state (user info only, no tokens) ──

export function getStoredUser(): { id: string; email: string; firstName: string; lastName: string; role: string; tenantId: string } | null {
  if (typeof window === 'undefined') return null;
  try {
    const stored = localStorage.getItem('user');
    return stored ? JSON.parse(stored) : null;
  } catch {
    return null;
  }
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

// ── Core fetch wrapper with cookie-based auth + automatic token refresh ──

export async function apiClient<T = unknown>(
  path: string,
  options: RequestInit = {},
): Promise<T> {
  const url = `${API_BASE_URL}${path}`;

  const makeRequest = () => {
    const headers: Record<string, string> = {
      ...((options.headers as Record<string, string>) || {}),
    };

    // Only set Content-Type for JSON bodies (not FormData)
    if (!options.body || typeof options.body === 'string') {
      headers['Content-Type'] = headers['Content-Type'] || 'application/json';
    }

    return fetch(url, {
      ...options,
      headers,
      credentials: 'include', // send httpOnly cookies
    });
  };

  let response = await makeRequest();

  // On 401, try cookie-based refresh then retry once
  if (response.status === 401) {
    const refreshed = await attemptRefresh();
    if (refreshed) {
      response = await makeRequest();
    } else {
      clearStoredUser();
      if (typeof window !== 'undefined') {
        window.location.href = '/es/auth/login';
      }
      throw new ApiRequestError(401, 'UNAUTHORIZED', 'Session expired');
    }
  }

  if (!response.ok) {
    let body: ApiError;
    try {
      body = await response.json();
    } catch {
      throw new ApiRequestError(
        response.status,
        'UNKNOWN_ERROR',
        response.statusText,
      );
    }
    throw new ApiRequestError(
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
