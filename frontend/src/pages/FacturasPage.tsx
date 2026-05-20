import { useEffect, useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { api, ApiError, type FacturaResumen } from '../lib/api.js';
import { useEmpresa, useEmpresaId } from '../lib/auth.js';
import { fechaCorta, formatearCedula, moneda, motivoHumano } from '../lib/format.js';
import { Hint } from '../components/Hint.js';
import { ConfirmDialog } from '../components/ConfirmDialog.js';
import { LimpiarPanel } from '../components/LimpiarPanel.js';

type Filtro =
  | { tipo: 'todos' }
  | { tipo: 'mes'; mes: string }
  | { tipo: 'revision' };

const mesActual = (): string => new Date().toISOString().slice(0, 7);

function nombreMes(mes: string): string {
  const m = mes.match(/^(\d{4})-(\d{2})$/);
  if (!m) return mes;
  const meses = [
    'enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio',
    'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre',
  ];
  return `${meses[Number(m[2]) - 1]} de ${m[1]}`;
}

export function FacturasPage() {
  const empresa_id = useEmpresaId();
  const empresa = useEmpresa();
  const [searchParams, setSearchParams] = useSearchParams();
  // Si llegamos con ?revision=1 (link desde Resumen IVA), arrancamos con ese filtro.
  const filtroInicial: Filtro =
    searchParams.get('revision') === '1' ? { tipo: 'revision' } : { tipo: 'todos' };
  const [filtro, setFiltro] = useState<Filtro>(filtroInicial);
  const [facturas, setFacturas] = useState<FacturaResumen[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    const params =
      filtro.tipo === 'mes'
        ? { empresa_id, mes: filtro.mes, limit: 500 }
        : filtro.tipo === 'revision'
          ? { empresa_id, pendientes_revision: true, limit: 500 }
          : { empresa_id, limit: 500 };
    api
      .listarFacturas(params)
      .then((res) => {
        if (cancelled) return;
        setFacturas(res.facturas);
        setTotal(res.total);
      })
      .catch((err) => {
        if (cancelled) return;
        setError(err instanceof ApiError ? err.humano : 'No se pudieron cargar las facturas.');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [empresa_id, filtro]);

  // Mantener el query string sincronizado con el filtro (solo para "revisión",
  // que es el caso donde un Link desde otra página querría linkearnos).
  useEffect(() => {
    if (filtro.tipo === 'revision' && searchParams.get('revision') !== '1') {
      setSearchParams({ revision: '1' }, { replace: true });
    } else if (filtro.tipo !== 'revision' && searchParams.get('revision') === '1') {
      setSearchParams({}, { replace: true });
    }
  }, [filtro, searchParams, setSearchParams]);

  const totales = useMemo(() => {
    let totalCrc = 0;
    let totalIva = 0;
    let pagadas = 0;
    let montoPagado = 0;
    let montoPendiente = 0;
    for (const f of facturas) {
      totalCrc += f.total_crc ?? 0;
      totalIva += f.iva_total_crc ?? 0;
      if (f.estado_pago === 'pagada') {
        pagadas += 1;
        montoPagado += f.total_crc ?? 0;
      } else {
        montoPendiente += f.total_crc ?? 0;
      }
    }
    return { totalCrc, totalIva, pagadas, montoPagado, montoPendiente };
  }, [facturas]);

  const [marcandoPago, setMarcandoPago] = useState<string | null>(null);
  const [confirmando, setConfirmando] = useState<FacturaResumen | null>(null);
  const [confirmandoRevision, setConfirmandoRevision] = useState<FacturaResumen | null>(null);
  const [marcandoRevision, setMarcandoRevision] = useState<string | null>(null);

  async function ejecutarRevision(): Promise<void> {
    const f = confirmandoRevision;
    if (!f) return;
    setMarcandoRevision(f.id);
    try {
      await api.marcarRevisionFactura({ id: f.id, revisada: true });
      if (filtro.tipo === 'revision') {
        // Si estamos viendo solo pendientes, la sacamos del listado.
        setFacturas((prev) => prev.filter((x) => x.id !== f.id));
      } else {
        setFacturas((prev) =>
          prev.map((x) =>
            x.id === f.id
              ? { ...x, revisada_por_humano: 1, fecha_revision: new Date().toISOString().slice(0, 10) }
              : x,
          ),
        );
      }
      setConfirmandoRevision(null);
    } catch (err) {
      setError(err instanceof ApiError ? err.humano : 'No se pudo marcar como revisada.');
      setConfirmandoRevision(null);
    } finally {
      setMarcandoRevision(null);
    }
  }

  async function ejecutarPago(): Promise<void> {
    const f = confirmando;
    if (!f) return;
    const queSeraDespues = f.estado_pago === 'pagada' ? 'pendiente' : 'pagada';
    setMarcandoPago(f.id);
    try {
      await api.marcarPagoFactura({ id: f.id, pagada: queSeraDespues === 'pagada' });
      setFacturas((prev) =>
        prev.map((x) =>
          x.id === f.id
            ? {
                ...x,
                estado_pago: queSeraDespues,
                fecha_pago: queSeraDespues === 'pagada' ? new Date().toISOString().slice(0, 10) : null,
              }
            : x,
        ),
      );
      setConfirmando(null);
    } catch (err) {
      setError(err instanceof ApiError ? err.humano : 'No se pudo actualizar el estado de pago.');
      setConfirmando(null);
    } finally {
      setMarcandoPago(null);
    }
  }

  // Meses con datos: los derivamos de las facturas que ya tenemos cargadas
  // (cuando el filtro es "todos"). Sirve para el dropdown rápido.
  const mesesConDatos = useMemo(() => {
    if (filtro.tipo !== 'todos') return [] as string[];
    const set = new Set<string>();
    for (const f of facturas) {
      if (f.fecha_emision && /^\d{4}-\d{2}/.test(f.fecha_emision)) {
        set.add(f.fecha_emision.slice(0, 7));
      }
    }
    return Array.from(set).sort().reverse();
  }, [facturas, filtro.tipo]);

  return (
    <div className="page">
      <header className="page-header">
        <h1>
          Facturas{' '}
          <Hint label="Qué hay en esta página">
            Lista todas las facturas ya procesadas. Hacé clic en cualquiera para ver el detalle.
            Las filas en amarillo necesitan tu revisión. Podés filtrar por mes con el selector.
          </Hint>
        </h1>
        <p className="page-subtitle">
          Historial de facturas procesadas · Empresa activa: <strong>{empresa.nombre}</strong>{' '}
          <span className="muted small">(céd. {formatearCedula(empresa.id)})</span>.{' '}
          <Link to="/ayuda#leer-resultado">¿Qué significa "revisión humana"? →</Link>
        </p>
      </header>

      <section className="card">
        <div className="filters">
          <div className="filtros-grupo">
            <label className="field field-inline">
              <span className="field-label">Mostrar</span>
              <select
                value={
                  filtro.tipo === 'todos'
                    ? '__todos'
                    : filtro.tipo === 'revision'
                      ? '__revision'
                      : filtro.mes
                }
                onChange={(e) => {
                  const v = e.target.value;
                  if (v === '__todos') setFiltro({ tipo: 'todos' });
                  else if (v === '__revision') setFiltro({ tipo: 'revision' });
                  else if (v === '__mes_actual') setFiltro({ tipo: 'mes', mes: mesActual() });
                  else setFiltro({ tipo: 'mes', mes: v });
                }}
              >
                <option value="__todos">Todas las facturas</option>
                <option value="__revision">⚠ Solo facturas para revisar</option>
                <option value="__mes_actual">Solo {nombreMes(mesActual())}</option>
                {mesesConDatos.map((m) => (
                  <option key={m} value={m}>Solo {nombreMes(m)}</option>
                ))}
              </select>
            </label>
            {filtro.tipo === 'mes' && (
              <label className="field field-inline">
                <span className="field-label">Mes específico</span>
                <input
                  type="month"
                  value={filtro.mes}
                  onChange={(e) => setFiltro({ tipo: 'mes', mes: e.target.value })}
                />
              </label>
            )}
          </div>
          <div className="filters-stats">
            <span><strong>{total}</strong> facturas</span>
            <span>Total: <strong>{moneda(totales.totalCrc, 'CRC')}</strong></span>
            <span>IVA: <strong>{moneda(totales.totalIva, 'CRC')}</strong></span>
            <span title="Suma de facturas marcadas como pagadas">
              Pagado: <strong className="text-success">{moneda(totales.montoPagado, 'CRC')}</strong>
            </span>
            <span title="Suma de facturas todavía pendientes de pago">
              Pendiente: <strong className="text-error">{moneda(totales.montoPendiente, 'CRC')}</strong>
            </span>
            <LimpiarPanel
              alcance={
                filtro.tipo === 'mes'
                  ? `las facturas de ${nombreMes(filtro.mes)}`
                  : filtro.tipo === 'revision'
                    ? 'las facturas pendientes de revisión'
                    : 'todas las facturas visibles'
              }
              mes={filtro.tipo === 'mes' ? filtro.mes : undefined}
              onArchivado={() => {
                setFiltro((prev) => ({ ...prev })); // re-trigger useEffect
              }}
            />
          </div>
        </div>

        {error && <div className="alert alert-error">{error}</div>}
        {loading ? (
          <div className="loader-inline"><div className="loader-spinner" /> Cargando…</div>
        ) : facturas.length === 0 ? (
          <div className="alert alert-info">
            {filtro.tipo === 'todos' ? (
              <>
                <strong>Aún no hay facturas cargadas.</strong>{' '}
                <Link to="/upload">Subí la primera desde "Subir facturas".</Link>
              </>
            ) : filtro.tipo === 'revision' ? (
              <>
                <strong>¡Felicidades!</strong> No hay facturas pendientes de revisión.{' '}
                <button
                  type="button"
                  className="btn btn-ghost btn-sm"
                  onClick={() => setFiltro({ tipo: 'todos' })}
                >
                  Ver todas las facturas
                </button>
              </>
            ) : (
              <>
                No hay facturas para <strong>{nombreMes(filtro.mes)}</strong>.{' '}
                <button
                  type="button"
                  className="btn btn-ghost btn-sm"
                  onClick={() => setFiltro({ tipo: 'todos' })}
                >
                  Ver todas las facturas
                </button>
              </>
            )}
          </div>
        ) : (
          <table className="table">
            <thead>
              <tr>
                <th>Fecha</th>
                <th>Proveedor</th>
                <th>Cédula</th>
                <th>No. Factura</th>
                <th>Total</th>
                <th>IVA</th>
                {filtro.tipo === 'revision' && (
                  <th>
                    Motivo{' '}
                    <Hint label="Por qué requiere revisión" size="sm" position="bottom">
                      Razón por la cual el sistema apartó esta factura. Verificá con el PDF original
                      antes de marcarla como revisada.
                    </Hint>
                  </th>
                )}
                <th>
                  Pago{' '}
                  <Hint label="Estado de pago" size="sm" position="bottom">
                    Marcá una factura como "pagada" cuando ya le pagaste al proveedor. El sistema
                    descuenta esos montos del total pendiente y lo muestra en el Excel.
                  </Hint>
                </th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {facturas.map((f) => {
                const pagada = f.estado_pago === 'pagada';
                const trClass = [
                  f.requiere_revision_humana ? 'row-warning' : '',
                  pagada ? 'row-pagada' : '',
                ]
                  .filter(Boolean)
                  .join(' ');
                return (
                  <tr key={f.id} className={trClass}>
                    <td>{fechaCorta(f.fecha_emision)}</td>
                    <td>{f.proveedor_nombre ?? '—'}</td>
                    <td className="mono">{f.proveedor_cedula}</td>
                    <td className="mono small">{f.id.slice(-12)}</td>
                    <td className="num">{moneda(f.total_crc, 'CRC')}</td>
                    <td className="num">{moneda(f.iva_total_crc, 'CRC')}</td>
                    {filtro.tipo === 'revision' && (
                      <td className="small">{motivoHumano(f.motivo_revision)}</td>
                    )}
                    <td>
                      {pagada ? (
                        <span className="badge badge-pagada" title={f.fecha_pago ? `Pagada el ${fechaCorta(f.fecha_pago)}` : 'Pagada'}>
                          ✓ Pagada
                          {f.fecha_pago && <span className="badge-fecha"> {fechaCorta(f.fecha_pago)}</span>}
                        </span>
                      ) : (
                        <span className="badge badge-pendiente">Pendiente</span>
                      )}
                    </td>
                    <td className="acciones-fila">
                      {filtro.tipo === 'revision' && (
                        <button
                          type="button"
                          className="btn btn-sm btn-primary"
                          disabled={marcandoRevision === f.id}
                          onClick={() => setConfirmandoRevision(f)}
                          title="Marcar esta factura como revisada — sale del listado de pendientes"
                        >
                          {marcandoRevision === f.id ? '…' : 'Marcar revisada'}
                        </button>
                      )}
                      <button
                        type="button"
                        className={`btn btn-sm ${pagada ? 'btn-ghost' : 'btn-primary'}`}
                        disabled={marcandoPago === f.id}
                        onClick={() => setConfirmando(f)}
                        title={
                          pagada
                            ? 'Revertir el pago — la factura vuelve a quedar como pendiente'
                            : 'Marcar esta factura como pagada al proveedor'
                        }
                      >
                        {marcandoPago === f.id
                          ? '…'
                          : pagada
                            ? 'Revertir pago'
                            : 'Marcar pagada'}
                      </button>
                      <Link to={`/facturas/${encodeURIComponent(f.id)}`} className="btn btn-ghost btn-sm">
                        Ver
                      </Link>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </section>

      <ConfirmDialog
        open={confirmandoRevision !== null}
        variant="success"
        title="¿Marcar como revisada?"
        message={
          confirmandoRevision ? (
            <>
              Confirmás que ya verificaste la factura de{' '}
              <strong>
                {confirmandoRevision.proveedor_nombre ?? confirmandoRevision.proveedor_cedula}
              </strong>{' '}
              y está correcta. Se va a sacar del listado de pendientes de revisión.
              <br />
              <span className="muted small">
                Motivo original: {motivoHumano(confirmandoRevision.motivo_revision)}
              </span>
            </>
          ) : (
            ''
          )
        }
        confirmText="Sí, marcar revisada"
        cancelText="Cancelar"
        busy={marcandoRevision !== null}
        onConfirm={() => void ejecutarRevision()}
        onCancel={() => setConfirmandoRevision(null)}
      />

      <ConfirmDialog
        open={confirmando !== null}
        variant={confirmando?.estado_pago === 'pagada' ? 'warning' : 'success'}
        title={
          confirmando?.estado_pago === 'pagada'
            ? '¿Revertir el pago?'
            : '¿Marcar como pagada?'
        }
        message={
          confirmando ? (
            confirmando.estado_pago === 'pagada' ? (
              <>
                La factura de{' '}
                <strong>{confirmando.proveedor_nombre ?? confirmando.proveedor_cedula}</strong>{' '}
                volverá a aparecer como <strong>pendiente</strong>.
              </>
            ) : (
              <>
                Vas a marcar como <strong>PAGADA</strong> la factura de{' '}
                <strong>{confirmando.proveedor_nombre ?? confirmando.proveedor_cedula}</strong>
                {' '}por <strong>{moneda(confirmando.total_crc, 'CRC')}</strong>.
                <br />
                Se va a registrar con la fecha de hoy y descontar del monto pendiente.
              </>
            )
          ) : (
            ''
          )
        }
        confirmText={
          confirmando?.estado_pago === 'pagada' ? 'Sí, revertir' : 'Sí, marcar pagada'
        }
        cancelText="Cancelar"
        busy={marcandoPago !== null}
        onConfirm={() => void ejecutarPago()}
        onCancel={() => setConfirmando(null)}
      />
    </div>
  );
}
