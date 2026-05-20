import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { api, ApiError, type FacturaResumen } from '../lib/api.js';
import { useEmpresa, useEmpresaId } from '../lib/auth.js';
import { fechaCorta, formatearCedula, moneda } from '../lib/format.js';
import { Hint } from '../components/Hint.js';
import { ConfirmDialog } from '../components/ConfirmDialog.js';

type FiltroEstado = 'todas' | 'activas' | 'archivadas';

export function HistorialPage() {
  const empresa_id = useEmpresaId();
  const empresa = useEmpresa();
  const [facturas, setFacturas] = useState<FacturaResumen[]>([]);
  const [stats, setStats] = useState<{ total: number; activas: number; archivadas: number } | null>(null);
  const [filtro, setFiltro] = useState<FiltroEstado>('todas');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [restaurando, setRestaurando] = useState<FacturaResumen | null>(null);
  const [enProceso, setEnProceso] = useState(false);

  function recargar(): void {
    setLoading(true);
    setError(null);
    api
      .historial({ empresa_id, limit: 1000 })
      .then((res) => {
        setFacturas(res.facturas);
        setStats({ total: res.total, activas: res.activas, archivadas: res.archivadas });
      })
      .catch((err) => {
        setError(err instanceof ApiError ? err.humano : 'No se pudo cargar el historial.');
      })
      .finally(() => setLoading(false));
  }

  useEffect(() => {
    recargar();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [empresa_id]);

  const visibles = useMemo(() => {
    if (filtro === 'activas') return facturas.filter((f) => !f.archivada);
    if (filtro === 'archivadas') return facturas.filter((f) => f.archivada);
    return facturas;
  }, [facturas, filtro]);

  async function ejecutarRestaurar(): Promise<void> {
    if (!restaurando) return;
    setEnProceso(true);
    setError(null);
    try {
      await api.restaurarFactura(restaurando.id);
      setRestaurando(null);
      recargar();
    } catch (err) {
      setError(err instanceof ApiError ? err.humano : 'No se pudo restaurar.');
    } finally {
      setEnProceso(false);
    }
  }

  return (
    <div className="page">
      <header className="page-header">
        <h1>
          Historial{' '}
          <Hint label="Qué es el historial">
            El registro permanente. Acá quedan TODAS las facturas, las que están activas y
            las que archivaste. Nada se borra de la base. Podés restaurar una factura
            archivada con un clic.
          </Hint>
        </h1>
        <p className="page-subtitle">
          Registro completo · Empresa activa: <strong>{empresa.nombre}</strong>{' '}
          <span className="muted small">(céd. {formatearCedula(empresa.id)})</span>.
        </p>
      </header>

      {stats && (
        <section className="card card-soft">
          <div className="grid grid-summary">
            <div>
              <div className="kv-label">Total en historial</div>
              <div className="kv-value">{stats.total}</div>
            </div>
            <div>
              <div className="kv-label">Activas</div>
              <div className="kv-value" style={{ color: '#0b6b2c' }}>{stats.activas}</div>
            </div>
            <div>
              <div className="kv-label">Archivadas</div>
              <div className="kv-value" style={{ color: '#6b7280' }}>{stats.archivadas}</div>
            </div>
          </div>
        </section>
      )}

      <section className="card">
        <div className="filters">
          <label className="field field-inline">
            <span className="field-label">Mostrar</span>
            <select value={filtro} onChange={(e) => setFiltro(e.target.value as FiltroEstado)}>
              <option value="todas">Todas (activas + archivadas)</option>
              <option value="activas">Solo activas</option>
              <option value="archivadas">Solo archivadas</option>
            </select>
          </label>
        </div>

        {error && <div className="alert alert-error">{error}</div>}

        {loading ? (
          <div className="loader-inline"><div className="loader-spinner" /> Cargando…</div>
        ) : visibles.length === 0 ? (
          <div className="alert alert-info">
            {facturas.length === 0 ? (
              <>
                <strong>El historial está vacío.</strong> Cuando proceses tu primera factura va a aparecer acá.{' '}
                <Link to="/upload">Subir una factura</Link>
              </>
            ) : (
              <>No hay facturas que coincidan con el filtro.</>
            )}
          </div>
        ) : (
          <table className="table">
            <thead>
              <tr>
                <th>Estado</th>
                <th>Fecha</th>
                <th>Proveedor</th>
                <th>No. Factura</th>
                <th>Total</th>
                <th>Archivada el</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {visibles.map((f) => (
                <tr key={f.id} className={f.archivada ? 'row-archivada' : ''}>
                  <td>
                    {f.archivada ? (
                      <span className="badge badge-archivada">Archivada</span>
                    ) : (
                      <span className="badge badge-pagada" style={{ background: '#e6f4ea', color: '#0b6b2c' }}>
                        Activa
                      </span>
                    )}
                  </td>
                  <td>{fechaCorta(f.fecha_emision)}</td>
                  <td>{f.proveedor_nombre ?? '—'}</td>
                  <td className="mono small">{f.id.slice(-12)}</td>
                  <td className="num">{moneda(f.total_crc, 'CRC')}</td>
                  <td className="small">
                    {f.fecha_archivado ? f.fecha_archivado.slice(0, 10) : '—'}
                  </td>
                  <td className="acciones-fila">
                    {f.archivada && (
                      <button
                        type="button"
                        className="btn btn-sm btn-primary"
                        onClick={() => setRestaurando(f)}
                        title="Volver a hacer visible esta factura en las pantallas normales"
                      >
                        Restaurar
                      </button>
                    )}
                    <Link to={`/facturas/${encodeURIComponent(f.id)}`} className="btn btn-ghost btn-sm">
                      Ver
                    </Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      <ConfirmDialog
        open={restaurando !== null}
        variant="info"
        title="¿Restaurar esta factura?"
        message={
          restaurando ? (
            <>
              La factura de <strong>{restaurando.proveedor_nombre ?? restaurando.proveedor_cedula}</strong>
              {' '}por <strong>{moneda(restaurando.total_crc, 'CRC')}</strong> volverá a aparecer en
              Facturas, Resumen IVA y los Excels normales.
            </>
          ) : (
            ''
          )
        }
        confirmText="Sí, restaurar"
        cancelText="Cancelar"
        busy={enProceso}
        onConfirm={() => void ejecutarRestaurar()}
        onCancel={() => setRestaurando(null)}
      />
    </div>
  );
}
