import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { api, ApiError, type FacturaResumen } from '../lib/api.js';
import { useEmpresa, useEmpresaId } from '../lib/auth.js';
import { formatearCedula, moneda, porcentaje } from '../lib/format.js';
import { Hint } from '../components/Hint.js';
import { LimpiarPanel } from '../components/LimpiarPanel.js';

type Filtro = { tipo: 'todos' } | { tipo: 'mes'; mes: string };

const mesActualStr = (): string => new Date().toISOString().slice(0, 7);

function nombreMes(mes: string): string {
  const m = mes.match(/^(\d{4})-(\d{2})$/);
  if (!m) return mes;
  const meses = [
    'enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio',
    'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre',
  ];
  return `${meses[Number(m[2]) - 1]} de ${m[1]}`;
}

export function ResumenIvaPage() {
  const empresa_id = useEmpresaId();
  const empresa = useEmpresa();
  const [filtro, setFiltro] = useState<Filtro>({ tipo: 'todos' });
  const [facturas, setFacturas] = useState<FacturaResumen[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    const params =
      filtro.tipo === 'mes'
        ? { empresa_id, mes: filtro.mes, limit: 500 }
        : { empresa_id, limit: 500 };
    api
      .listarFacturas(params)
      .then((res) => {
        if (cancelled) return;
        setFacturas(res.facturas);
      })
      .catch((err) => {
        if (cancelled) return;
        setError(err instanceof ApiError ? err.humano : 'No se pudo cargar el resumen.');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [empresa_id, filtro]);

  // El backend no expone aún el desglose por tarifa de cada factura en /facturas (resumen).
  // Mientras tanto, agrupamos por revision-humana y damos los totales del período.
  // El desglose REAL por tarifa requiere joinear con lineas_factura (Fase 5+).
  const { totalCrc, totalIva, conRevision, sinRevision, pendientesRevision } = useMemo(() => {
    let totalCrc = 0;
    let totalIva = 0;
    let conRevision = 0;
    let sinRevision = 0;
    let pendientesRevision = 0;
    for (const f of facturas) {
      totalCrc += f.total_crc ?? 0;
      totalIva += f.iva_total_crc ?? 0;
      if (f.requiere_revision_humana) {
        conRevision++;
        if (!f.revisada_por_humano) pendientesRevision++;
      } else {
        sinRevision++;
      }
    }
    return { totalCrc, totalIva, conRevision, sinRevision, pendientesRevision };
  }, [facturas]);

  // Aproximación de IVA promedio efectivo (iva / base).
  const baseAprox = totalCrc - totalIva;
  const tarifaEfectiva = baseAprox > 0 ? Math.round((totalIva / baseAprox) * 1000) / 10 : 0;

  return (
    <div className="page">
      <header className="page-header">
        <h1>
          Resumen de IVA{' '}
          <Hint label="Qué hay en esta página">
            Cuánto IVA pagaste por cada tarifa (0 %, 1 %, 2 %, 4 %, 13 %, Exento) en el período.
            Es el cuadro que necesitás para la D-104 mensual de Hacienda.
          </Hint>
        </h1>
        <p className="page-subtitle">
          Desglose por tarifa para la declaración del IVA · Empresa activa: <strong>{empresa.nombre}</strong>{' '}
          <span className="muted small">(céd. {formatearCedula(empresa.id)})</span>.{' '}
          <Link to="/ayuda#resumen-iva">¿Cómo leer este cuadro? →</Link>
        </p>
      </header>

      <section className="card">
        <div className="filters">
          <div className="filtros-grupo">
            <label className="field field-inline">
              <span className="field-label">Mostrar</span>
              <select
                value={filtro.tipo === 'todos' ? '__todos' : filtro.mes}
                onChange={(e) => {
                  const v = e.target.value;
                  if (v === '__todos') setFiltro({ tipo: 'todos' });
                  else if (v === '__mes_actual') setFiltro({ tipo: 'mes', mes: mesActualStr() });
                  else setFiltro({ tipo: 'mes', mes: v });
                }}
              >
                <option value="__todos">Todas las facturas</option>
                <option value="__mes_actual">Solo {nombreMes(mesActualStr())}</option>
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
          <LimpiarPanel
            alcance={
              filtro.tipo === 'mes'
                ? `las facturas de ${nombreMes(filtro.mes)}`
                : 'todas las facturas visibles'
            }
            mes={filtro.tipo === 'mes' ? filtro.mes : undefined}
            onArchivado={() => setFiltro((prev) => ({ ...prev }))}
          />
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
            ) : (
              <>
                No hay facturas en <strong>{nombreMes(filtro.mes)}</strong>.{' '}
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
          <>
            <div className="grid grid-summary">
              <div>
                <div className="kv-label">Total facturas</div>
                <div className="kv-value kv-value-lg">{facturas.length}</div>
              </div>
              <div>
                <div className="kv-label">Sumatoria CRC</div>
                <div className="kv-value">{moneda(totalCrc, 'CRC')}</div>
              </div>
              <div>
                <div className="kv-label">IVA total CRC</div>
                <div className="kv-value">{moneda(totalIva, 'CRC')}</div>
              </div>
              <div>
                <div className="kv-label">Tarifa efectiva</div>
                <div className="kv-value">{porcentaje(tarifaEfectiva)}</div>
              </div>
              <div>
                <div className="kv-label">Sin revisión</div>
                <div className="kv-value">{sinRevision}</div>
              </div>
              <div>
                <div className="kv-label">
                  Para revisar{' '}
                  <Hint label="Qué significa" size="sm" position="bottom">
                    Facturas que el sistema marcó porque algo no le cerró (OCR borroso, cédula no
                    encontrada, totales que no cuadran). Hacé clic para verlas y marcarlas como
                    revisadas.
                  </Hint>
                </div>
                {pendientesRevision > 0 ? (
                  <Link
                    to="/facturas?revision=1"
                    className="kv-value kv-link-warning"
                    title="Abrir el listado de facturas pendientes de revisión"
                  >
                    {pendientesRevision} →
                  </Link>
                ) : (
                  <div className="kv-value" style={{ color: '#0b6b2c' }}>
                    {conRevision === 0 ? '0' : `0 (${conRevision} revisadas)`}
                  </div>
                )}
              </div>
            </div>
            <p className="muted small">
              Para el desglose línea por línea con cada tarifa (0%, 1%, 2%, 4%, 13%), abrí el Google Sheet
              de la empresa o consultá al Asistente:
              <em> "Mostrame el desglose por tarifa de este mes"</em>.
            </p>
          </>
        )}
      </section>
    </div>
  );
}
