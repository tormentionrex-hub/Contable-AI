import { useEffect, useRef, useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { api, ApiError } from '../lib/api.js';
import { useEmpresa, useEmpresaId } from '../lib/auth.js';
import { Hint } from '../components/Hint.js';

interface Turno {
  rol: 'user' | 'assistant';
  mensaje: string;
  sql_ejecutado?: string | null;
  duracion_ms?: number;
}

const PREGUNTAS_SUGERIDAS = [
  '¿Cuánto se gastó este mes?',
  '¿Cuál fue la factura más cara del mes?',
  '¿Qué proveedor tuvo más facturas?',
  'Mostrame las facturas con IVA al 13 % de este mes',
  '¿Cuántas facturas tienen revisión humana pendiente?',
];

export function ChatPage() {
  const empresa_id = useEmpresaId();
  const empresa = useEmpresa();
  const [turnos, setTurnos] = useState<Turno[]>([]);
  const [mensaje, setMensaje] = useState('');
  const [enviando, setEnviando] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [mostrarSql, setMostrarSql] = useState(false);
  const fondoRef = useRef<HTMLDivElement>(null);

  // Auto-scroll al final cuando llega un nuevo turno.
  useEffect(() => {
    if (fondoRef.current) fondoRef.current.scrollIntoView({ behavior: 'smooth' });
  }, [turnos, enviando]);

  // Cargar historial al entrar.
  useEffect(() => {
    let cancelled = false;
    api
      .historialChat(20)
      .then((res) => {
        if (cancelled) return;
        setTurnos(res.turnos.map((t) => ({ rol: t.rol, mensaje: t.mensaje })));
      })
      .catch(() => {
        /* historial es best-effort */
      });
    return () => {
      cancelled = true;
    };
  }, []);

  async function enviar(texto: string) {
    if (!texto.trim() || enviando) return;
    setError(null);
    setMensaje('');
    setTurnos((prev) => [...prev, { rol: 'user', mensaje: texto }]);
    setEnviando(true);
    try {
      const res = await api.preguntarAsistente(texto, empresa_id, true);
      setTurnos((prev) => [
        ...prev,
        {
          rol: 'assistant',
          mensaje: res.respuesta,
          sql_ejecutado: res.sql_ejecutado,
          duracion_ms: res.duracion_ms,
        },
      ]);
    } catch (err) {
      const msg = err instanceof ApiError ? err.humano : 'No se pudo consultar al asistente.';
      setError(msg);
      setTurnos((prev) => [
        ...prev,
        { rol: 'assistant', mensaje: `Hubo un problema: ${msg}` },
      ]);
    } finally {
      setEnviando(false);
    }
  }

  function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    void enviar(mensaje);
  }

  return (
    <div className="page chat-page">
      <header className="page-header">
        <h1>
          Asistente Contable{' '}
          <Hint label="Qué hace el asistente">
            Hacele preguntas en español sobre tus facturas. Es de solo lectura: no puede borrar ni
            modificar nada, podés experimentar tranquilo.
          </Hint>
        </h1>
        <p className="page-subtitle">
          Preguntá en español sobre tus facturas · Empresa activa: <strong>{empresa.nombre}</strong>.{' '}
          <Link to="/ayuda#asistente">Ver ejemplos en la guía →</Link>
        </p>
      </header>

      <div className="chat-container">
        <div className="chat-stream">
          {turnos.length === 0 && (
            <div className="chat-empty">
              <p>Hola, soy tu asistente contable. Probá una de estas preguntas:</p>
              <ul className="chat-suggestions">
                {PREGUNTAS_SUGERIDAS.map((p) => (
                  <li key={p}>
                    <button type="button" className="btn btn-ghost btn-sm" onClick={() => void enviar(p)}>
                      {p}
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {turnos.map((t, i) => (
            <div key={i} className={`chat-bubble chat-${t.rol}`}>
              <div className="chat-bubble-content">{t.mensaje}</div>
              {t.rol === 'assistant' && mostrarSql && t.sql_ejecutado && (
                <details className="chat-sql">
                  <summary>SQL ejecutado ({t.duracion_ms ?? 0} ms)</summary>
                  <pre>{t.sql_ejecutado}</pre>
                </details>
              )}
            </div>
          ))}

          {enviando && (
            <div className="chat-bubble chat-assistant">
              <div className="chat-bubble-content typing">
                <span /><span /><span />
              </div>
            </div>
          )}

          <div ref={fondoRef} />
        </div>

        {error && <div className="alert alert-error">{error}</div>}

        <form className="chat-input" onSubmit={onSubmit}>
          <textarea
            value={mensaje}
            onChange={(e) => setMensaje(e.target.value)}
            placeholder="Escribí tu pregunta…"
            rows={2}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                void enviar(mensaje);
              }
            }}
          />
          <div className="chat-input-actions">
            <label className="checkbox" title="Solo para administradores: muestra la consulta técnica que ejecutó el asistente">
              <input
                type="checkbox"
                checked={mostrarSql}
                onChange={(e) => setMostrarSql(e.target.checked)}
              />
              Modo avanzado{' '}
              <Hint label="Qué es el modo avanzado" size="sm">
                Muestra la consulta SQL que el asistente ejecutó para responderte.
                Útil para verificar cómo interpretó tu pregunta. Si no programás, dejalo apagado.
              </Hint>
            </label>
            <button type="submit" className="btn btn-primary" disabled={enviando || !mensaje.trim()}>
              {enviando ? 'Pensando…' : 'Enviar'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
