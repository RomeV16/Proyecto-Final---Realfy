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
  apiClient,
  getStoredUser,
  setStoredUser,
  clearStoredUser,
  ApiRequestError,
} from './api-client';
import type { AuthResponse } from '@realfy/shared';

interface User {
  id: string;
  email: string;
  firstName: string;
  lastName: string;
  role: string;
  tenantId: string;
}

interface AuthContextValue {
  user: User | null;
  isAuthenticated: boolean;
  isLoading: boolean;
  login: (email: string, password: string) => Promise<void>;
  register: (data: {
    email: string;
    password: string;
    firstName: string;
    lastName: string;
  }) => Promise<void>;
  logout: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return ctx;
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  // Hydrate user info from localStorage on mount (user data only, not tokens)
  useEffect(() => {
    const persisted = getStoredUser();
    if (persisted) {
      setUser(persisted);
    }
    setIsLoading(false);
  }, []);

  const login = useCallback(async (email: string, password: string) => {
    // API sets httpOnly cookies automatically
    const res = await apiClient<AuthResponse>('/auth/login', {
      method: 'POST',
      body: JSON.stringify({ email, password }),
    });

    const userData: User = {
      id: res.user.id,
      email: res.user.email,
      firstName: res.user.firstName,
      lastName: res.user.lastName,
      role: res.user.role,
      tenantId: res.user.tenantId,
    };
    setStoredUser(userData);
    setUser(userData);
  }, []);

  const register = useCallback(
    async (data: {
      email: string;
      password: string;
      firstName: string;
      lastName: string;
    }) => {
      const res = await apiClient<AuthResponse>('/auth/register', {
        method: 'POST',
        body: JSON.stringify(data),
      });

      const userData: User = {
        id: res.user.id,
        email: res.user.email,
        firstName: res.user.firstName,
        lastName: res.user.lastName,
        role: res.user.role,
        tenantId: res.user.tenantId,
      };
      setStoredUser(userData);
      setUser(userData);
    },
    [],
  );

  const logout = useCallback(async () => {
    try {
      await apiClient('/auth/logout', { method: 'POST' });
    } catch {
      // Ignore errors — we're logging out anyway
    }
    clearStoredUser();
    setUser(null);
    window.location.href = '/es/auth/login';
  }, []);

  return (
    <AuthContext.Provider
      value={{
        user,
        isAuthenticated: !!user,
        isLoading,
        login,
        register,
        logout,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}
