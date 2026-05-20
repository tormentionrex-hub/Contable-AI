import { type ReactNode } from 'react';
import { Navigate, useLocation } from 'react-router-dom';
import { useAuth } from '../lib/auth.js';

/**
 * Bloquea el render hasta que sepamos si hay sesión. Si no hay, redirige a /login.
 * En modo dev (auth_enabled=false en el backend) el AuthContext setea un user
 * ficticio, así que esto pasa derecho.
 */
export function RequireAuth({ children }: { children: ReactNode }) {
  const { user, loading } = useAuth();
  const location = useLocation();

  if (loading) {
    return (
      <div className="loader-fullscreen">
        <div className="loader-spinner" aria-label="Cargando" />
        <p>Conectando con el motor…</p>
      </div>
    );
  }

  if (!user) {
    return <Navigate to="/login" replace state={{ from: location.pathname }} />;
  }

  return <>{children}</>;
}
