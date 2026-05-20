import { useEffect, useState, type FormEvent } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { useAuth } from '../lib/auth.js';
import { ApiError } from '../lib/api.js';

interface LocationState {
  from?: string;
}

export function LoginPage() {
  const { login, user, authEnabled, loading, backendOffline, retry } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Si ya hay sesión (incluido modo dev), saltar a la app.
  useEffect(() => {
    if (!loading && user) {
      const from = (location.state as LocationState)?.from ?? '/upload';
      navigate(from, { replace: true });
    }
  }, [loading, user, navigate, location.state]);

  async function handleSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      await login(email.trim(), password);
      const from = (location.state as LocationState)?.from ?? '/upload';
      navigate(from, { replace: true });
    } catch (err) {
      if (err instanceof ApiError) {
        if (err.status === 503) {
          setError(
            'El servidor todavía no tiene autenticación habilitada. Pedile al admin que setee JWT_SECRET en el .env del backend.',
          );
        } else {
          setError(err.humano);
        }
      } else {
        setError('No se pudo conectar con el motor. Verificá que esté corriendo en http://localhost:3001');
      }
    } finally {
      setSubmitting(false);
    }
  }

  // -------------------------------------------------------------
  // Estado 1: cargando el bootstrap inicial
  // -------------------------------------------------------------
  if (loading) {
    return (
      <div className="login-screen">
        <div className="login-card">
          <div className="brand-large">
            <span className="brand-logo brand-logo-lg" aria-hidden="true">F</span>
            <h1>Forward Contabilidad</h1>
            <p className="brand-tagline">Contable AI — conectando con el motor…</p>
          </div>
          <div className="loader-inline"><div className="loader-spinner" /> Verificando estado del servidor…</div>
        </div>
      </div>
    );
  }

  // -------------------------------------------------------------
  // Estado 2: backend OFFLINE — el motor no respondió
  // -------------------------------------------------------------
  if (backendOffline) {
    return (
      <div className="login-screen">
        <div className="login-card">
          <div className="brand-large">
            <span className="brand-logo brand-logo-lg" aria-hidden="true">F</span>
            <h1>Forward Contabilidad</h1>
            <p className="brand-tagline">Contable AI</p>
          </div>

          <div className="alert alert-error" role="alert">
            <strong>El sistema no está disponible en este momento.</strong>
            <p style={{ margin: '8px 0 0' }}>
              No pudimos conectarnos al servidor. Esto suele resolverse en un
              minuto. Hacé clic en "Reintentar" o avisale al administrador.
            </p>
          </div>

          <button
            type="button"
            className="btn btn-primary btn-block"
            onClick={retry}
            style={{ marginTop: 16 }}
          >
            Reintentar conexión
          </button>

          <details style={{ marginTop: 16, fontSize: 12, color: 'var(--color-muted)' }}>
            <summary style={{ cursor: 'pointer' }}>Información técnica (para el administrador)</summary>
            <p style={{ margin: '8px 0 0' }}>
              El backend no respondió en <code>http://localhost:3001</code>. Verificá que el
              servicio del motor esté corriendo. Si está en modo DEV (sin <code>JWT_SECRET</code>),
              el login se salta automáticamente cuando el motor vuelva.
            </p>
          </details>
        </div>
      </div>
    );
  }

  // -------------------------------------------------------------
  // Estado 3 (raro): backend online en modo dev, pero useEffect aún no redirigió.
  // (Esto se ve solo durante un frame, por eso no agregamos UI propia.)
  // Estado 4: backend con auth habilitada → formulario de login normal
  // -------------------------------------------------------------
  return (
    <div className="login-screen">
      <div className="login-card">
        <div className="brand-large">
          <span className="brand-logo brand-logo-lg" aria-hidden="true">F</span>
          <h1>Forward Contabilidad</h1>
          <p className="brand-tagline">Contable AI — Sistema para tu firma</p>
        </div>

        {!authEnabled && (
          <div className="alert alert-info">
            El motor está en modo desarrollo. Entrando automáticamente…
          </div>
        )}

        {authEnabled && (
          <form onSubmit={handleSubmit} className="form-stack">
            <label className="field">
              <span className="field-label">Correo electrónico</span>
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
                autoComplete="username"
                placeholder="vos@forwardcr.com"
              />
            </label>

            <label className="field">
              <span className="field-label">Contraseña</span>
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
                autoComplete="current-password"
                placeholder="••••••••"
              />
            </label>

            {error && <div className="alert alert-error" role="alert">{error}</div>}

            <button type="submit" className="btn btn-primary btn-block" disabled={submitting}>
              {submitting ? 'Entrando…' : 'Entrar'}
            </button>
          </form>
        )}

        <p className="login-footer">
          ¿No te acordás de la contraseña? Pedile al administrador que te la restablezca.
        </p>
      </div>
    </div>
  );
}
