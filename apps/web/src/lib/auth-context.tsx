'use client';

import {
  createContext,
  useContext,
  useState,
  useEffect,
  useCallback,
  useRef,
  type ReactNode,
} from 'react';
import {
  apiClient,
  getStoredUser,
  setStoredUser,
  clearStoredUser,
  ApiRequestError,
} from './api-client';
import { localizedPath } from '@/i18n/locale-path';
import { assignLocation, replaceLocation } from './hard-navigation';
import { SessionExitCover } from '@/components/transition/session-exit-cover';
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
  updateUser: (partial: Partial<User>) => void;
}

const AuthContext = createContext<AuthContextValue | null>(null);

/**
 * Sesión del staff sin exigir el proveedor: devuelve null fuera de él. Lo usan el
 * menú y los permisos, que también se montan en piezas compartidas por toda la web
 * (por ejemplo la transición de ingreso, que vive en el layout de idioma).
 */
export function useOptionalAuth(): AuthContextValue | null {
  return useContext(AuthContext);
}

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
  const [isLoggingOut, setIsLoggingOut] = useState(false);
  const loggingOut = useRef(false);

  // Hydrate user info from localStorage on mount (user data only, not tokens)
  useEffect(() => {
    const persisted = getStoredUser();
    if (persisted) {
      setUser(persisted);
      setIsLoading(false);
      return;
    }
    // Hay cookie de sesión (el middleware dejó pasar) pero este navegador no
    // guarda quién es el usuario, y la API no expone el perfil propio: en vez
    // de dejar el panel sin nombre y cargando para siempre, se pide el ingreso
    // de nuevo y se vuelve a la pantalla en la que estaba.
    clearStoredUser();
    const back = encodeURIComponent(window.location.pathname + window.location.search);
    replaceLocation(`${localizedPath('/auth/login')}?redirect=${back}`);
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

  const updateUser = useCallback((partial: Partial<User>) => {
    setUser((prev) => {
      if (!prev) return prev;
      const next = { ...prev, ...partial };
      setStoredUser(next);
      return next;
    });
  }, []);

  // La salida no vacía el usuario en pantalla: el panel queda como estaba, tapado, hasta que el
  // navegador carga el ingreso. Vaciarlo antes mostraba un instante el panel sin nombre ni menú.
  const logout = useCallback(async () => {
    if (loggingOut.current) return;
    loggingOut.current = true;
    setIsLoggingOut(true);
    try {
      await apiClient('/auth/logout', { method: 'POST' });
    } catch {
      // Ignore errors — we're logging out anyway
    }
    clearStoredUser();
    assignLocation(localizedPath('/auth/login'));
  }, []);

  // Al volver con "atrás" después de salir, el navegador puede restaurar esta página tal como
  // quedó (tapada y sin sesión): en ese caso se vuelve a pedir el ingreso.
  useEffect(() => {
    const onPageShow = (event: PageTransitionEvent) => {
      if (event.persisted && loggingOut.current) {
        replaceLocation(localizedPath('/auth/login'));
      }
    };
    window.addEventListener('pageshow', onPageShow);
    return () => window.removeEventListener('pageshow', onPageShow);
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
        updateUser,
      }}
    >
      {children}
      {isLoggingOut && <SessionExitCover />}
    </AuthContext.Provider>
  );
}
