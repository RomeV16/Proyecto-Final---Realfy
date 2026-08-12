'use client';

import {
  createContext,
  useContext,
  useState,
  useEffect,
  useCallback,
  type ReactNode,
} from 'react';
import {
  portalApiClient,
  setPortalTokens,
  clearPortalTokens,
  getPortalAccessToken,
} from './portal-api-client';
import type { PortalAuthResponse } from '@realfy/shared';

interface PortalPerson {
  id: string;
  email: string;
  firstName: string;
  lastName: string;
  tenantId: string;
}

interface PortalAuthContextValue {
  person: PortalPerson | null;
  isAuthenticated: boolean;
  isLoading: boolean;
  login: (email: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
}

const PortalAuthContext = createContext<PortalAuthContextValue | null>(null);

export function usePortalAuth(): PortalAuthContextValue {
  const ctx = useContext(PortalAuthContext);
  if (!ctx) {
    throw new Error('usePortalAuth must be used within a PortalAuthProvider');
  }
  return ctx;
}

function persistPortalPerson(person: PortalPerson) {
  localStorage.setItem('portalPerson', JSON.stringify(person));
}

function loadPersistedPortalPerson(): PortalPerson | null {
  if (typeof window === 'undefined') return null;
  const stored = localStorage.getItem('portalPerson');
  if (!stored) return null;
  try {
    return JSON.parse(stored) as PortalPerson;
  } catch {
    return null;
  }
}

export function PortalAuthProvider({ children }: { children: ReactNode }) {
  const [person, setPerson] = useState<PortalPerson | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  // Hydrate from localStorage on mount
  useEffect(() => {
    const token = getPortalAccessToken();
    const persisted = loadPersistedPortalPerson();

    if (token && persisted) {
      setPerson(persisted);
    } else if (token) {
      // Token exists but no person — clear stale state
      clearPortalTokens();
    }
    setIsLoading(false);
  }, []);

  const login = useCallback(async (email: string, password: string) => {
    const res = await portalApiClient<PortalAuthResponse>(
      '/portal/auth/login',
      {
        method: 'POST',
        body: JSON.stringify({ email, password }),
      },
    );

    setPortalTokens(res.tokens.accessToken, res.tokens.refreshToken);
    const personData: PortalPerson = {
      id: res.person.id,
      email: res.person.email,
      firstName: res.person.firstName,
      lastName: res.person.lastName,
      tenantId: res.person.tenantId,
    };
    persistPortalPerson(personData);
    setPerson(personData);
  }, []);

  const logout = useCallback(async () => {
    try {
      await portalApiClient('/portal/auth/logout', { method: 'POST' });
    } catch {
      // Ignore errors — we're logging out anyway
    }
    clearPortalTokens();
    setPerson(null);
    window.location.href = '/es/portal/auth/login';
  }, []);

  return (
    <PortalAuthContext.Provider
      value={{
        person,
        isAuthenticated: !!person,
        isLoading,
        login,
        logout,
      }}
    >
      {children}
    </PortalAuthContext.Provider>
  );
}
