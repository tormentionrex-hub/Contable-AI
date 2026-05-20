import { useEffect, useRef, useState, type ChangeEvent, type DragEvent } from 'react';
import { Link } from 'react-router-dom';
import { api, ApiError, descargarBlob, type FacturaResumen } from '../lib/api.js';
import { useEmpresa, useEmpresaId } from '../lib/auth.js';
import { fechaCorta, fechaLarga, formatearCedula, moneda, motivoHumano, porcentaje } from '../lib/format.js';
import { Hint } from '../components/Hint.js';
import { LimpiarPanel } from '../components/LimpiarPanel.js';

interface Linea {
  numero_linea: number;
  descripcion: string;
  cantidad: number;
  precio_unitario: number;
  monto_total: number;
  tarifa_iva_marcada?: number | null;
  tarifa_iva_inferida?: number | null;
  base_imponible?: number | null;
  iva_calculado?: number | null;
}

interface FacturaExtraida {
  fuente: string;
  confianza_extraccion: number;
  requiere_revision_humana: boolean;
  motivo_revision: string | null;
  factura: {
    clave_numerica?: string | null;
    consecutivo?: string | null;
    tipo_documento?: string | null;
    fecha_emision: string;
    moneda: string;
    proveedor: { nombre: string; cedula: string; actividad_economica?: string | null };
    lineas: Linea[];
    totales: {
      subtotal: number;
      iva_total: number;
      total_factura: number;
      iva_por_tarifa?: Record<string, number>;
    };
  };
}

interface ResumenTaxIva {
  status: 'ok' | 'revision_humana' | 'error';
  factura_id: string;
  tarifas_detectadas: number[];
  total_crc: number;
  motivos_revision: string[];
  mensaje_para_contador: string;
}

interface Resultado {
  factura: FacturaExtraida;
  resumen: ResumenTaxIva;
  sheet: { sheet_id: string | null; filas: { reintegro: number; detalle: number }; revision: boolean } | null;
}

interface ResultadoMulti {
  multi: true;
  total: number;
  archivos_subidos?: number;
  procesadas?: number;
  fallidas?: number;
  resultados: Resultado[];
  errores?: Array<{ indice: number; filename?: string; error: string; codigo: string }>;
}

type Respuesta = Resultado | ResultadoMulti;

// Clave para persistir el último batch en sessionStorage. Sobrevive a navegación
// entre páginas pero NO al cierre de pestaña — eso es deliberado: si el contador
// quiere volver a verlo más tarde, ya está en /facturas.
const STORAGE_KEY = 'fwd_upload_last_batch';

interface PersistedBatch {
  empresa_id: string;
  procesadas: number;
  fallidas: number;
  total: number;
  ts: number;
  respuesta: Respuesta;
}

function loadPersistedBatch(empresa_id: string): PersistedBatch | null {
  try {
    const raw = sessionStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as PersistedBatch;
    if (parsed.empresa_id !== empresa_id) return null;
    return parsed;
  } catch {
    return null;
  }
}

function savePersistedBatch(batch: PersistedBatch): void {
  try {
    sessionStorage.setItem(STORAGE_KEY, JSON.stringify(batch));
  } catch {
    /* quota lleno: ignoramos, no es crítico */
  }
}

function clearPersistedBatch(): void {
  try {
    sessionStorage.removeItem(STORAGE_KEY);
  } catch {
    /* ignore */
  }
}

export function UploadPage() {
  const empresa_id = useEmpresaId();
  const empresa = useEmpresa();
  const [files, setFiles] = useState<File[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const [resultado, setResultado] = useState<Respuesta | null>(null);
  const [batchInfo, setBatchInfo] = useState<{ ts: number; procesadas: number; fallidas: number } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [progresoMsg, setProgresoMsg] = useState<string>('');
  const [recientes, setRecientes] = useState<FacturaResumen[]>([]);
  const [recientesLoading, setRecientesLoading] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const folderInputRef = useRef<HTMLInputElement>(null);
  const progresoTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const mountedRef = useRef(true);

  // Cleanup al desmontar: cancelar timer y marcar que cualquier finally que
  // venga después no debe llamar setState.
  useEffect(() => {
    return () => {
      mountedRef.current = false;
      if (progresoTimerRef.current) {
        clearInterval(progresoTimerRef.current);
        progresoTimerRef.current = null;
      }
    };
  }, []);
  const [isDragging, setIsDragging] = useState(false);
  const [descargando, setDescargando] = useState<'reintegro' | 'tax-iva' | null>(null);

  // Restaurar el último batch al montar (vuelta desde /facturas, etc.).
  useEffect(() => {
    const persisted = loadPersistedBatch(empresa_id);
    if (persisted) {
      setResultado(persisted.respuesta);
      setBatchInfo({
        ts: persisted.ts,
        procesadas: persisted.procesadas,
        fallidas: persisted.fallidas,
      });
    }
  }, [empresa_id]);

  // Cargar lista de facturas recientes desde el backend (sobreviven a logout).
  useEffect(() => {
    let cancelled = false;
    setRecientesLoading(true);
    api
      .listarFacturas({ empresa_id, limit: 10 })
      .then((res) => {
        if (cancelled) return;
        setRecientes(res.facturas);
      })
      .catch(() => {
        /* best effort */
      })
      .finally(() => {
        if (!cancelled) setRecientesLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [empresa_id, resultado]); // recargar después de un batch nuevo

  function addFiles(list: FileList | File[] | null): void {
    if (!list) return;
    const arr = Array.from(list as FileList);
    const filtered: File[] = [];
    for (const f of arr) {
      const ext = f.name.toLowerCase();
      if (!ext.endsWith('.pdf') && !ext.endsWith('.xml')) continue;
      if (f.size > 20 * 1024 * 1024) continue;
      filtered.push(f);
    }
    if (filtered.length === 0) {
      setError('No se encontraron PDFs o XMLs válidos (máx 20 MB cada uno).');
      return;
    }
    setError(null);
    setFiles((prev) => {
      // Evitar duplicados por nombre+size.
      const seen = new Set(prev.map((f) => `${f.name}|${f.size}`));
      const nuevos = filtered.filter((f) => !seen.has(`${f.name}|${f.size}`));
      return [...prev, ...nuevos];
    });
  }

  function removeFile(idx: number): void {
    setFiles((prev) => prev.filter((_, i) => i !== idx));
  }

  function clearAll(): void {
    setFiles([]);
    setResultado(null);
    setBatchInfo(null);
    setError(null);
    clearPersistedBatch();
    if (inputRef.current) inputRef.current.value = '';
    if (folderInputRef.current) folderInputRef.current.value = '';
  }

  async function handleSubmit(): Promise<void> {
    if (files.length === 0) return;
    setSubmitting(true);
    setError(null);
    setResultado(null);
    setProgresoMsg(
      files.length === 1
        ? 'Extrayendo factura con DocScan…'
        : `Procesando ${files.length} archivos…`,
    );

    if (progresoTimerRef.current) clearInterval(progresoTimerRef.current);
    progresoTimerRef.current = setInterval(() => {
      if (!mountedRef.current) return;
      setProgresoMsg((prev) => {
        if (prev.includes('DocScan')) return 'Clasificando tarifas IVA con Tax-IVA…';
        if (prev.includes('Tax-IVA')) return 'Reconciliando contra el pie de cada factura…';
        return 'Escribiendo en la base y Google Sheets…';
      });
    }, 8_000);

    try {
      const res = (files.length === 1
        ? await api.procesarDocumento(files[0]!, empresa_id)
        : await api.procesarDocumentos(files, empresa_id)) as Respuesta;
      setResultado(res);

      // Calcular contadores para el badge.
      const procesadas = 'multi' in res ? res.procesadas ?? res.resultados.length : 1;
      const fallidas = 'multi' in res ? res.fallidas ?? 0 : 0;
      const total = 'multi' in res ? res.total : 1;
      setBatchInfo({ ts: Date.now(), procesadas, fallidas });
      savePersistedBatch({
        empresa_id,
        procesadas,
        fallidas,
        total,
        ts: Date.now(),
        respuesta: res,
      });

      setFiles([]);
      if (inputRef.current) inputRef.current.value = '';
      if (folderInputRef.current) folderInputRef.current.value = '';
    } catch (err) {
      if (err instanceof ApiError) {
        setError(err.humano);
      } else {
        setError('Falló el procesamiento. Verificá que el backend esté corriendo.');
      }
    } finally {
      if (progresoTimerRef.current) {
        clearInterval(progresoTimerRef.current);
        progresoTimerRef.current = null;
      }
      // Sólo tocamos estado si el componente sigue montado.
      if (mountedRef.current) {
        setSubmitting(false);
        setProgresoMsg('');
      }
    }
  }

  function onDrop(e: DragEvent<HTMLDivElement>): void {
    e.preventDefault();
    setIsDragging(false);
    addFiles(e.dataTransfer.files);
  }

  async function descargarExcel(tipo: 'reintegro' | 'tax-iva'): Promise<void> {
    setDescargando(tipo);
    setError(null);
    try {
      // No filtramos por mes: descargamos TODAS las facturas que estén cargadas
      // en la base. Si el contador quiere filtrar por un mes específico, lo
      // hace desde la página Caja Chica (Reintegro) o desde Resumen IVA (Tax-IVA).
      const blob =
        tipo === 'reintegro'
          ? await api.descargarExcelReintegro({ empresa_id, saldo: true })
          : await api.descargarExcelTaxIva({ empresa_id });
      const stamp = new Date().toISOString().slice(0, 10);
      const filename =
        tipo === 'reintegro'
          ? `reintegro-caja-chica-${empresa_id}-${stamp}.xlsx`
          : `tax-iva-${empresa_id}-${stamp}.xlsx`;
      descargarBlob(blob, filename);
    } catch (err) {
      setError(err instanceof ApiError ? err.humano : 'No se pudo descargar el Excel.');
    } finally {
      setDescargando(null);
    }
  }

  const procesadas = 'multi' in (resultado ?? {}) ? (resultado as ResultadoMulti).procesadas ?? 0 : resultado ? 1 : 0;
  const fallidas = 'multi' in (resultado ?? {}) ? (resultado as ResultadoMulti).fallidas ?? 0 : 0;
  void procesadas;
  void fallidas;

  return (
    <div className="page">
      <header className="page-header">
        <h1>
          Subir facturas{' '}
          <Hint label="Qué hace esta página">
            Subí tus facturas (PDF o XML) y el sistema las lee con IA, calcula el IVA y
            las anota en tu Google Sheet. Podés arrastrar archivos sueltos o una carpeta entera.
          </Hint>
        </h1>
        <p className="page-subtitle">
          PDF nativo, PDF escaneado o XML de Hacienda. Hasta 50 archivos a la vez · Empresa activa: <strong>{empresa.nombre}</strong>{' '}
          <span className="muted small">(céd. {formatearCedula(empresa.id)})</span>.
        </p>
        <p className="page-subtitle">
          <Link to="/ayuda#subir-facturas">¿Cómo subir facturas? Leé la guía →</Link>
        </p>
      </header>

      <section className="card">
        <div
          className={`dropzone ${isDragging ? 'is-dragging' : ''}`}
          onDragOver={(e) => {
            e.preventDefault();
            setIsDragging(true);
          }}
          onDragLeave={() => setIsDragging(false)}
          onDrop={onDrop}
          onClick={() => inputRef.current?.click()}
          role="button"
          tabIndex={0}
        >
          <input
            ref={inputRef}
            type="file"
            multiple
            accept=".pdf,.xml,application/pdf,application/xml,text/xml"
            onChange={(e: ChangeEvent<HTMLInputElement>) => addFiles(e.target.files)}
            hidden
          />
          <input
            ref={folderInputRef}
            type="file"
            // @ts-expect-error — atributo no estándar válido en Chromium/Edge/Firefox modernos
            webkitdirectory=""
            directory=""
            multiple
            onChange={(e: ChangeEvent<HTMLInputElement>) => addFiles(e.target.files)}
            hidden
          />
          {files.length > 0 ? (
            <div className="dropzone-files">
              <strong>{files.length} archivo{files.length === 1 ? '' : 's'} listos</strong>
              <span className="muted">Hacé clic en Procesar para extraerlos</span>
            </div>
          ) : (
            <div className="dropzone-prompt">
              <strong>Arrastrá tus facturas aquí</strong>
              <span className="muted">PDF / XML · hasta 50 archivos · clic para elegir</span>
            </div>
          )}
        </div>

        {files.length > 0 && (
          <ul className="file-list">
            {files.map((f, i) => (
              <li key={`${f.name}-${i}`} className="file-item">
                <span className="file-name">{f.name}</span>
                <span className="muted small">{(f.size / 1024).toFixed(0)} KB</span>
                <button
                  type="button"
                  className="btn btn-ghost btn-sm"
                  onClick={(e) => {
                    e.stopPropagation();
                    removeFile(i);
                  }}
                  aria-label={`Quitar ${f.name}`}
                >
                  Quitar
                </button>
              </li>
            ))}
          </ul>
        )}

        {error && <div className="alert alert-error" role="alert">{error}</div>}

        <div className="form-actions">
          <button
            type="button"
            className="btn btn-secondary"
            onClick={(e) => {
              e.stopPropagation();
              folderInputRef.current?.click();
            }}
            disabled={submitting}
            title="Elegí una carpeta y el sistema sube todos los PDF/XML que encuentre adentro"
          >
            Elegir carpeta…
          </button>
          <button
            type="button"
            className="btn btn-ghost"
            onClick={clearAll}
            disabled={submitting || (files.length === 0 && !resultado)}
          >
            Limpiar
          </button>
          <button
            type="button"
            className="btn btn-primary"
            disabled={files.length === 0 || submitting}
            onClick={handleSubmit}
          >
            {submitting
              ? 'Procesando…'
              : files.length === 0
                ? 'Procesar'
                : files.length === 1
                  ? 'Procesar factura'
                  : `Procesar ${files.length} facturas`}
          </button>
        </div>

        {submitting && (
          <div className="processing-status">
            <div className="loader-spinner" aria-hidden="true" />
            <div>
              <div className="status-title">{progresoMsg || 'Procesando…'}</div>
              <div className="status-subtitle">
                Cada factura tarda ~25-40 s. Mientras tanto podés cambiar de pestaña.
              </div>
            </div>
          </div>
        )}
      </section>

      {batchInfo && (
        <section className="card card-soft">
          <div className="batch-summary">
            <div>
              <h3>Último lote procesado</h3>
              <p className="muted small">
                {new Date(batchInfo.ts).toLocaleString('es-CR')} ·{' '}
                <strong className="text-success">{batchInfo.procesadas} ok</strong>
                {batchInfo.fallidas > 0 && (
                  <> · <strong className="text-error">{batchInfo.fallidas} con error</strong></>
                )}
              </p>
            </div>
            <div className="batch-actions">
              <button
                type="button"
                className="btn btn-ghost btn-sm"
                onClick={() => descargarExcel('reintegro')}
                disabled={descargando !== null}
                title="Excel con formato Forward para pedir el reintegro de Caja Chica"
              >
                {descargando === 'reintegro' ? 'Generando…' : 'Descargar Excel de Caja Chica'}
              </button>
              <button
                type="button"
                className="btn btn-ghost btn-sm"
                onClick={() => descargarExcel('tax-iva')}
                disabled={descargando !== null}
                title="Excel con las 24 columnas oficiales para la declaración de IVA"
              >
                {descargando === 'tax-iva' ? 'Generando…' : 'Descargar Excel para Hacienda'}
              </button>
              <Link to="/facturas" className="btn btn-ghost btn-sm">
                Ver todas →
              </Link>
            </div>
          </div>
        </section>
      )}

      {resultado && (
        <section className="results">
          {'multi' in resultado ? (
            <>
              <h2>
                Se procesaron {resultado.procesadas ?? resultado.resultados.length} de {resultado.total} facturas
                {resultado.fallidas ? ` · ${resultado.fallidas} con error` : ''}
              </h2>
              {resultado.errores && resultado.errores.length > 0 && (
                <div className="alert alert-warning">
                  <strong>Errores del lote:</strong>
                  <ul>
                    {resultado.errores.map((e, i) => (
                      <li key={i}>
                        <strong>{e.filename ?? `#${e.indice}`}:</strong> {motivoHumano(e.codigo)} ({e.error.slice(0, 120)})
                      </li>
                    ))}
                  </ul>
                </div>
              )}
              {resultado.resultados.map((r, i) => (
                <FacturaResultadoCard key={i} idx={i + 1} resultado={r} />
              ))}
            </>
          ) : (
            <FacturaResultadoCard idx={1} resultado={resultado} />
          )}
        </section>
      )}

      <section className="card">
        <div className="card-header">
          <h2>Procesadas recientemente</h2>
          <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
            <LimpiarPanel
              alcance="todas las facturas cargadas hasta ahora"
              descripcion="Archivar todas las facturas cargadas. Antes se ofrece guardar un Excel de respaldo."
              onArchivado={() => {
                // Recargar lista de recientes después de archivar.
                api
                  .listarFacturas({ empresa_id, limit: 10 })
                  .then((res) => setRecientes(res.facturas))
                  .catch(() => {
                    /* best effort */
                  });
              }}
            />
            <Link to="/facturas" className="btn btn-ghost btn-sm">
              Ver todas
            </Link>
          </div>
        </div>
        {recientesLoading ? (
          <div className="loader-inline"><div className="loader-spinner" /> Cargando…</div>
        ) : recientes.length === 0 ? (
          <p className="muted">Aún no hay facturas en la base. Subí la primera arriba.</p>
        ) : (
          <table className="table">
            <thead>
              <tr>
                <th>Fecha</th>
                <th>Proveedor</th>
                <th>No. Factura</th>
                <th>Total</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {recientes.map((f) => (
                <tr key={f.id} className={f.requiere_revision_humana ? 'row-warning' : ''}>
                  <td>{fechaCorta(f.fecha_emision)}</td>
                  <td>{f.proveedor_nombre ?? '—'}</td>
                  <td className="mono small">{f.id.slice(-12)}</td>
                  <td className="num">{moneda(f.total_crc, 'CRC')}</td>
                  <td>
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
    </div>
  );
}

function FacturaResultadoCard({ idx, resultado }: { idx: number; resultado: Resultado }): JSX.Element {
  const f = resultado.factura.factura;
  const lineas = f.lineas;
  const porTarifa = new Map<number, { base: number; iva: number; total: number; count: number }>();
  for (const l of lineas) {
    const t = (l.tarifa_iva_inferida ?? l.tarifa_iva_marcada ?? 13) as number;
    const e = porTarifa.get(t) ?? { base: 0, iva: 0, total: 0, count: 0 };
    e.base += l.base_imponible ?? 0;
    e.iva += l.iva_calculado ?? 0;
    e.total += l.monto_total ?? 0;
    e.count += 1;
    porTarifa.set(t, e);
  }
  const tarifasOrdenadas = [...porTarifa.entries()].sort(([a], [b]) => a - b);

  return (
    <article className={`card ${resultado.factura.requiere_revision_humana ? 'card-warning' : ''}`}>
      <div className="card-header">
        <div>
          <h3>
            Factura {idx} — {f.proveedor.nombre}
          </h3>
          <p className="muted">
            {fechaLarga(f.fecha_emision)} · {f.tipo_documento ?? 'FE'}
            {f.consecutivo && ` · #${f.consecutivo}`}
          </p>
        </div>
        <div className="card-meta">
          <span className="badge">{resultado.resumen.status}</span>
          {resultado.factura.requiere_revision_humana && (
            <span className="badge badge-warning">Revisión humana</span>
          )}
        </div>
      </div>

      <p className="mensaje-contador">{resultado.resumen.mensaje_para_contador}</p>

      {resultado.factura.requiere_revision_humana && resultado.factura.motivo_revision && (
        <div className="alert alert-warning">
          <strong>Motivo de revisión:</strong> {motivoHumano(resultado.factura.motivo_revision)}
        </div>
      )}

      <div className="grid grid-summary">
        <div>
          <div className="kv-label">Total factura</div>
          <div className="kv-value kv-value-lg">{moneda(f.totales.total_factura, f.moneda)}</div>
        </div>
        <div>
          <div className="kv-label">Subtotal (sin IVA)</div>
          <div className="kv-value">{moneda(f.totales.subtotal, f.moneda)}</div>
        </div>
        <div>
          <div className="kv-label">IVA total</div>
          <div className="kv-value">{moneda(f.totales.iva_total, f.moneda)}</div>
        </div>
        <div>
          <div className="kv-label">Líneas</div>
          <div className="kv-value">{lineas.length}</div>
        </div>
      </div>

      <h4>Desglose por tarifa IVA</h4>
      <table className="table">
        <thead>
          <tr>
            <th>Tarifa</th>
            <th>Líneas</th>
            <th>Base gravable</th>
            <th>IVA</th>
            <th>Total</th>
          </tr>
        </thead>
        <tbody>
          {tarifasOrdenadas.map(([t, e]) => (
            <tr key={t}>
              <td>{porcentaje(t)}</td>
              <td>{e.count}</td>
              <td className="num">{moneda(e.base, f.moneda)}</td>
              <td className="num">{moneda(e.iva, f.moneda)}</td>
              <td className="num">{moneda(e.total, f.moneda)}</td>
            </tr>
          ))}
        </tbody>
      </table>

      {resultado.sheet && (
        <p className="muted small">
          Escrito en Google Sheets: {resultado.sheet.filas.reintegro} fila(s) en Reintegro + {resultado.sheet.filas.detalle} en Detalle Hacienda.
        </p>
      )}
    </article>
  );
}
