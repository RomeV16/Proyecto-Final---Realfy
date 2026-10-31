import { createApiClient, ApiRequestError, type BlobResult } from './create-api-client';

export { ApiRequestError, createApiClient };
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
