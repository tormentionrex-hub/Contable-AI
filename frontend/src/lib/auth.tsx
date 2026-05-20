/**
 * AuthContext: guarda el user actual y el token. Si el backend está en modo DEV
 * (sin JWT_SECRET), `me()` devuelve auth_enabled=false y nosotros marcamos un
 * "modo dev" donde el user es ficticio y empresa_id = 3006696489.
 */

import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import { api, getToken, setToken, type UserPublic, ApiError } from './api.js';

interface EmpresaActiva {
  id: string;
  nombre: string;
}

interface AuthState {
  user: UserPublic | null;
  empresa: EmpresaActiva;
  authEnabled: boolean;
  loading: boolean;
  /** True cuando el motor no respondió al primer /auth/me (offline o caído). */
  backendOffline: boolean;
  login: (email: string, password: string) => Promise<void>;
  logout: () => void;
  /** Re-ejecuta el bootstrap (útil para botón "Reintentar"). */
  retry: () => void;
}

const AuthContext = createContext<AuthState | null>(null);

const DEV_USER: UserPublic = {
  id: 0,
  email: 'dev@local',
  nombre: 'Modo Dev (sin auth)',
  rol: 'admin',
  empresa_id: '3006696489',
};

const EMPRESA_PLACEHOLDER: EmpresaActiva = {
  id: '3006696489',
  nombre: 'FUNDACION CRC Endurance',
};

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<UserPublic | null>(null);
  const [empresa, setEmpresa] = useState<EmpresaActiva>(EMPRESA_PLACEHOLDER);
  const [authEnabled, setAuthEnabled] = useState(true);
  const [loading, setLoading] = useState(true);
  const [backendOffline, setBackendOffline] = useState(false);
  const [retryTick, setRetryTick] = useState(0);

  // Bootstrap: al cargar la app, intentamos validar el token guardado.
  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    (async () => {
      try {
        const me = await api.me();
        if (cancelled) return;
        setBackendOffline(false);
        if (me.empresa) setEmpresa(me.empresa);
        if (me.auth_enabled === false) {
          // Backend en dev mode: usamos un user ficticio. NO se muestra login.
          setUser(DEV_USER);
          setAuthEnabled(false);
        } else {
          setUser(me.user);
          setAuthEnabled(true);
        }
      } catch (err) {
        if (cancelled) return;
        if (err instanceof ApiError && err.status === 401) {
          // 401 → auth habilitada, token vencido o ausente. Mostramos /login.
          setUser(null);
          setAuthEnabled(true);
          setBackendOffline(false);
          setToken(null);
        } else {
          // TypeError de fetch (connection refused, CORS, DNS) → backend offline.
          setUser(null);
          setAuthEnabled(true);
          setBackendOffline(true);
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [retryTick]);

  async function login(email: string, password: string): Promise<void> {
    const res = await api.login(email, password);
    setToken(res.token);
    setUser(res.user);
    setAuthEnabled(true);
    setBackendOffline(false);
    // Re-traer empresa tras login (puede ser distinta para cada contador).
    try {
      const me = await api.me();
      if (me.empresa) setEmpresa(me.empresa);
    } catch {
      /* best-effort: la empresa se quedará con el placeholder. */
    }
  }

  function logout(): void {
    setToken(null);
    setUser(null);
  }

  function retry(): void {
    setRetryTick((t) => t + 1);
  }

  return (
    <AuthContext.Provider
      value={{ user, empresa, authEnabled, loading, backendOffline, login, logout, retry }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth(): AuthState {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth debe usarse dentro de <AuthProvider>');
  return ctx;
}

/**
 * Devuelve el empresa_id efectivo para usar en queries.
 * - Si el user es contador: su empresa_id del token.
 * - Si es admin (o dev): la empresa piloto por default.
 *   (En un futuro: selector de empresa en el header para admins.)
 */
export function useEmpresaId(): string {
  const { user } = useAuth();
  if (user?.rol === 'contador' && user.empresa_id) return user.empresa_id;
  return user?.empresa_id ?? '3006696489';
}

/**
 * Devuelve la empresa activa con id + nombre. Usar en lugar de useEmpresaId
 * cuando se necesita mostrar el nombre humano en pantalla.
 */
export function useEmpresa(): EmpresaActiva {
  const { empresa } = useAuth();
  return empresa;
}

// Pre-cargado por si el token ya estaba en localStorage al refrescar la página.
export function tieneToken(): boolean {
  return !!getToken();
}
