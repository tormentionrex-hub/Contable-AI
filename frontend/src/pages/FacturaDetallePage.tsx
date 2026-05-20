import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { api, ApiError } from '../lib/api.js';
import { fechaCorta, fechaLarga, moneda, motivoHumano, porcentaje } from '../lib/format.js';
import { ConfirmDialog } from '../components/ConfirmDialog.js';

interface LineaRow {
  numero_linea: number;
  descripcion: string;
  cantidad: number;
  precio_unitario: number;
  monto_total: number;
  tarifa_iva: number;
  base_imponible: number;
  iva_calculado: number;
}

interface FacturaRow {
  id: string;
  fecha_emision: string;
  proveedor_cedula: string;
  receptor_nombre: string | null;
  moneda: string;
  total_factura: number;
  subtotal: number;
  iva_total: number;
  total_crc: number;
  iva_total_crc: number;
  tipo_cambio: number | null;
  requiere_revision_humana: number;
  motivo_revision: string | null;
  estado_hacienda: string | null;
  consecutivo: string | null;
  tipo_documento: string | null;
  estado_pago?: 'pendiente' | 'pagada';
  fecha_pago?: string | null;
  notas_pago?: string | null;
}

export function FacturaDetallePage() {
  const { id } = useParams<{ id: string }>();
  const [data, setData] = useState<{ factura: FacturaRow; lineas: LineaRow[] } | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [marcando, setMarcando] = useState(false);
  const [confirmAbierto, setConfirmAbierto] = useState(false);

  useEffect(() => {
    if (!id) return;
    let cancelled = false;
    api
      .obtenerFactura(id)
      .then((res) => {
        if (cancelled) return;
        setData(res as unknown as { factura: FacturaRow; lineas: LineaRow[] });
      })
      .catch((err) => {
        if (cancelled) return;
        setError(err instanceof ApiError ? err.humano : 'No se pudo cargar la factura.');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [id]);

  async function ejecutarPago(): Promise<void> {
    if (!data || !id) return;
    const f = data.factura;
    const pagadaAhora = f.estado_pago === 'pagada';
    setMarcando(true);
    setError(null);
    try {
      const res = await api.marcarPagoFactura({ id, pagada: !pagadaAhora });
      setData((prev) =>
        prev
          ? {
              ...prev,
              factura: {
                ...prev.factura,
                estado_pago: res.estado_pago,
                fecha_pago: res.fecha_pago,
                notas_pago: res.notas_pago,
              },
            }
          : prev,
      );
      setConfirmAbierto(false);
    } catch (err) {
      setError(err instanceof ApiError ? err.humano : 'No se pudo actualizar el estado de pago.');
      setConfirmAbierto(false);
    } finally {
      setMarcando(false);
    }
  }

  if (loading) {
    return (
      <div className="page">
        <div className="loader-inline"><div className="loader-spinner" /> Cargando…</div>
      </div>
    );
  }
  if (error || !data) {
    return (
      <div className="page">
        <Link to="/facturas" className="btn btn-ghost btn-sm">← Volver</Link>
        <div className="alert alert-error">{error ?? 'Factura no encontrada.'}</div>
      </div>
    );
  }
  const f = data.factura;

  return (
    <div className="page">
      <Link to="/facturas" className="btn btn-ghost btn-sm">← Volver al listado</Link>

      <header className="page-header">
        <h1>{f.receptor_nombre ?? 'Factura'} — {moneda(f.total_factura, f.moneda)}</h1>
        <p className="page-subtitle">
          {fechaLarga(f.fecha_emision)} · {f.tipo_documento ?? 'FE'}
          {f.consecutivo && ` · #${f.consecutivo}`}
        </p>
      </header>

      {f.requiere_revision_humana === 1 && (
        <div className="alert alert-warning">
          <strong>Requiere revisión humana:</strong> {motivoHumano(f.motivo_revision)}
        </div>
      )}

      <section className="card">
        <div className="card-header">
          <div>
            <h2>Estado de pago</h2>
            <p className="muted small" style={{ margin: '4px 0 0' }}>
              Marcá esta factura como pagada cuando ya le hayas pagado al proveedor.
            </p>
          </div>
          <div className="pago-actions">
            {f.estado_pago === 'pagada' ? (
              <span className="badge badge-pagada" title={f.fecha_pago ?? ''}>
                ✓ Pagada{f.fecha_pago && <span className="badge-fecha"> · {fechaCorta(f.fecha_pago)}</span>}
              </span>
            ) : (
              <span className="badge badge-pendiente">Pendiente de pago</span>
            )}
            <button
              type="button"
              className={`btn btn-sm ${f.estado_pago === 'pagada' ? 'btn-ghost' : 'btn-primary'}`}
              disabled={marcando}
              onClick={() => setConfirmAbierto(true)}
            >
              {marcando
                ? 'Guardando…'
                : f.estado_pago === 'pagada'
                  ? 'Revertir pago'
                  : 'Marcar como pagada'}
            </button>
          </div>
        </div>
      </section>

      <section className="card">
        <h2>Resumen</h2>
        <div className="grid grid-summary">
          <div><div className="kv-label">Moneda</div><div className="kv-value">{f.moneda}</div></div>
          <div><div className="kv-label">Tipo cambio</div><div className="kv-value">{f.tipo_cambio ?? '—'}</div></div>
          <div><div className="kv-label">Subtotal</div><div className="kv-value">{moneda(f.subtotal, f.moneda)}</div></div>
          <div><div className="kv-label">IVA</div><div className="kv-value">{moneda(f.iva_total, f.moneda)}</div></div>
          <div><div className="kv-label">Total CRC</div><div className="kv-value">{moneda(f.total_crc, 'CRC')}</div></div>
          <div><div className="kv-label">Estado Hacienda</div><div className="kv-value">{f.estado_hacienda ?? '—'}</div></div>
        </div>
      </section>

      <section className="card">
        <h2>Líneas ({data.lineas.length})</h2>
        <table className="table">
          <thead>
            <tr>
              <th>#</th>
              <th>Descripción</th>
              <th className="num">Cant.</th>
              <th className="num">Unitario</th>
              <th className="num">Base</th>
              <th>Tarifa</th>
              <th className="num">IVA</th>
              <th className="num">Total</th>
            </tr>
          </thead>
          <tbody>
            {data.lineas.map((l) => (
              <tr key={l.numero_linea}>
                <td>{l.numero_linea}</td>
                <td>{l.descripcion}</td>
                <td className="num">{l.cantidad}</td>
                <td className="num">{moneda(l.precio_unitario, f.moneda)}</td>
                <td className="num">{moneda(l.base_imponible, f.moneda)}</td>
                <td>{porcentaje(l.tarifa_iva)}</td>
                <td className="num">{moneda(l.iva_calculado, f.moneda)}</td>
                <td className="num">{moneda(l.monto_total, f.moneda)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      <section className="card">
        <h2>Datos del documento</h2>
        <dl className="dl-grid">
          <dt>ID interno</dt><dd className="mono small">{f.id}</dd>
          <dt>Proveedor (cédula)</dt><dd className="mono">{f.proveedor_cedula}</dd>
          <dt>Consecutivo</dt><dd className="mono">{f.consecutivo ?? '—'}</dd>
        </dl>
      </section>

      <ConfirmDialog
        open={confirmAbierto}
        variant={f.estado_pago === 'pagada' ? 'warning' : 'success'}
        title={
          f.estado_pago === 'pagada'
            ? '¿Revertir el pago?'
            : '¿Marcar como pagada?'
        }
        message={
          f.estado_pago === 'pagada' ? (
            <>Esta factura volverá a aparecer como <strong>pendiente</strong>.</>
          ) : (
            <>
              Vas a marcar como <strong>PAGADA</strong> esta factura por{' '}
              <strong>{moneda(f.total_factura, f.moneda)}</strong>.
              <br />
              Se registrará con la fecha de hoy.
            </>
          )
        }
        confirmText={
          f.estado_pago === 'pagada' ? 'Sí, revertir' : 'Sí, marcar pagada'
        }
        cancelText="Cancelar"
        busy={marcando}
        onConfirm={() => void ejecutarPago()}
        onCancel={() => setConfirmAbierto(false)}
      />
    </div>
  );
}
