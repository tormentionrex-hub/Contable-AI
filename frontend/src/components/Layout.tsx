import { NavLink, Outlet, useNavigate } from 'react-router-dom';
import { useAuth } from '../lib/auth.js';

export function Layout() {
  const { user, authEnabled, logout } = useAuth();
  const navigate = useNavigate();

  function handleLogout() {
    logout();
    navigate('/login', { replace: true });
  }

  return (
    <div className="app-shell">
      <header className="app-header">
        <div className="brand">
          <span className="brand-logo" aria-hidden="true">F</span>
          <div>
            <div className="brand-title">Forward Contabilidad</div>
            <div className="brand-subtitle">Contable AI</div>
          </div>
        </div>
        <nav className="nav-primary" aria-label="Navegación principal">
          <NavLink to="/upload" title="Subir PDFs o XMLs y procesarlos con IA">Subir facturas</NavLink>
          <NavLink to="/facturas" title="Ver todas las facturas ya procesadas">Facturas</NavLink>
          <NavLink to="/resumen-iva" title="Cuánto IVA pagaste por cada tarifa">Resumen IVA</NavLink>
          <NavLink to="/caja-chica" title="Saldo de caja chica y adelantos">Caja Chica</NavLink>
          <NavLink to="/chat" title="Preguntá en español sobre tus facturas">Asistente</NavLink>
          <NavLink to="/historial" title="Registro permanente de TODAS las facturas, incluyendo archivadas">Historial</NavLink>
          {user?.rol === 'admin' && <NavLink to="/admin" title="Gestión de usuarios y configuración">Admin</NavLink>}
          <NavLink to="/ayuda" title="Guía de uso y glosario" className="nav-help">
            Ayuda
          </NavLink>
        </nav>
        <div className="user-block">
          <div className="user-info">
            <div className="user-name">{user?.nombre ?? 'Sin usuario'}</div>
            <div className="user-meta">
              {user?.rol ?? '—'} {!authEnabled && <span className="badge-dev">DEV</span>}
            </div>
          </div>
          <button type="button" className="btn btn-ghost" onClick={handleLogout}>
            Salir
          </button>
        </div>
      </header>
      <main className="app-main">
        <Outlet />
      </main>
    </div>
  );
}
