import { useEffect, useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { api, ApiError, descargarBlob } from '../lib/api.js';
import { useEmpresa, useEmpresaId } from '../lib/auth.js';
import { formatearCedula, moneda } from '../lib/format.js';
import { Hint } from '../components/Hint.js';
import { LimpiarPanel } from '../components/LimpiarPanel.js';

interface SaldoCajaChica {
  empresa_id: string;
  desde: string;
  hasta: string;
  adelantos_abiertos_crc: number;
  facturas_periodo_crc: number;
  cantidad_adelantos: number;
  cantidad_facturas: number;
  saldo: number;
}

function nombreMesLargo(mes: string): string {
  const m = mes.match(/^(\d{4})-(\d{2})$/);
  if (!m) return mes;
  const meses = [
    'enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio',
    'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre',
  ];
  return `${meses[Number(m[2]) - 1]} de ${m[1]}`;
}

/** ¿El rango desde/hasta es el "infinito" que devuelve el backend cuando no hay filtro? */
function esRangoInfinito(desde: string, hasta: string): boolean {
  return desde.startsWith('0000') || hasta.startsWith('9999');
}

export function CajaChicaPage() {
  const empresa_id = useEmpresaId();
  const empresa = useEmpresa();
  const [saldo, setSaldo] = useState<SaldoCajaChica | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Formulario de adelantos.
  const [monto, setMonto] = useState('');
  const [fecha, setFecha] = useState(() => new Date().toISOString().slice(0, 10));
  const [responsable, setResponsable] = useState('');
  const [notas, setNotas] = useState('');
  const [enviando, setEnviando] = useState(false);
  const [exito, setExito] = useState<string | null>(null);

  // Descarga del Excel.
  const [descargando, setDescargando] = useState(false);
  const [mesExcel, setMesExcel] = useState<string>(() => new Date().toISOString().slice(0, 7));

  function refrescarSaldo() {
    setLoading(true);
    setError(null);
    api
      .saldoCajaChica(empresa_id)
      .then((s) => setSaldo(s))
      .catch((err) => setError(err instanceof ApiError ? err.humano : 'No se pudo cargar el saldo.'))
      .finally(() => setLoading(false));
  }

  useEffect(() => {
    refrescarSaldo();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [empresa_id]);

  async function registrarAdelanto(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setExito(null);
    setError(null);
    const montoNum = Number(monto);
    if (!Number.isFinite(montoNum) || montoNum <= 0) {
      setError('Ingresá un monto válido en colones (mayor a 0).');
      return;
    }
    setEnviando(true);
    try {
      await api.crearAdelanto({
        empresa_id,
        monto_crc: montoNum,
        fecha_entrega: fecha,
        responsable: responsable.trim() || undefined,
        notas: notas.trim() || undefined,
      });
      setExito(`Adelanto de ${moneda(montoNum, 'CRC')} registrado.`);
      setMonto('');
      setResponsable('');
      setNotas('');
      refrescarSaldo();
    } catch (err) {
      setError(err instanceof ApiError ? err.humano : 'No se pudo registrar el adelanto.');
    } finally {
      setEnviando(false);
    }
  }

  async function descargarReintegro() {
    setDescargando(true);
    setError(null);
    try {
      const blob = await api.descargarExcelReintegro({
        empresa_id,
        mes: mesExcel,
        saldo: true,
      });
      descargarBlob(blob, `reintegro-caja-chica-${empresa_id}-${mesExcel}.xlsx`);
    } catch (err) {
      setError(err instanceof ApiError ? err.humano : 'No se pudo descargar el Excel.');
    } finally {
      setDescargando(false);
    }
  }

  return (
    <div className="page">
      <header className="page-header">
        <h1>
          Caja Chica{' '}
          <Hint label="Cómo funciona Caja Chica">
            Registrás un adelanto (efectivo que te dieron) y a medida que subís facturas, el sistema
            las descuenta del saldo. Cuando llega a poco, generás el Excel de Reintegro para pedir
            más fondos.
          </Hint>
        </h1>
        <p className="page-subtitle">
          Saldo líquido = adelanto recibido − facturas del período · Empresa activa: <strong>{empresa.nombre}</strong>{' '}
          <span className="muted small">(céd. {formatearCedula(empresa.id)})</span>.{' '}
          <Link to="/ayuda#caja-chica">¿Cómo funciona Caja Chica? →</Link>
        </p>
      </header>

      {error && <div className="alert alert-error">{error}</div>}

      <section className="card">
        <div className="card-header">
          <h2>Saldo actual</h2>
          <LimpiarPanel
            alcance="todos los adelantos y facturas de caja chica"
            incluirAdelantos
            descripcion="Archivar adelantos y facturas de caja chica. Antes se ofrece un Excel de respaldo."
            onArchivado={() => refrescarSaldo()}
          />
        </div>
        {loading ? (
          <div className="loader-inline"><div className="loader-spinner" /> Cargando…</div>
        ) : saldo ? (
          <div className="grid grid-summary">
            <div>
              <div className="kv-label">Adelantos abiertos</div>
              <div className="kv-value">{moneda(saldo.adelantos_abiertos_crc, 'CRC')}</div>
              <div className="muted small">{saldo.cantidad_adelantos} entregas</div>
            </div>
            <div>
              <div className="kv-label">Facturas del periodo</div>
              <div className="kv-value">{moneda(saldo.facturas_periodo_crc, 'CRC')}</div>
              <div className="muted small">{saldo.cantidad_facturas} facturas</div>
            </div>
            <div>
              <div className="kv-label">Saldo líquido</div>
              <div
                className="kv-value kv-value-lg"
                style={{ color: saldo.saldo >= 0 ? '#0b6b2c' : '#8a1c14' }}
              >
                {moneda(saldo.saldo, 'CRC')}
              </div>
              <div className="muted small">
                {saldo.saldo >= 0 ? 'Saldo a devolver' : 'Falta reponer'}
              </div>
            </div>
            <div>
              <div className="kv-label">Periodo</div>
              <div className="kv-value" style={{ fontSize: 16 }}>
                {esRangoInfinito(saldo.desde, saldo.hasta) ? 'Todo el historial' : `${saldo.desde} → ${saldo.hasta}`}
              </div>
              <div className="muted small">
                {esRangoInfinito(saldo.desde, saldo.hasta)
                  ? 'Sin filtro de fechas'
                  : 'Filtrado'}
              </div>
            </div>
          </div>
        ) : (
          <p className="muted">Sin datos.</p>
        )}
      </section>

      <section className="card">
        <h2>Registrar adelanto</h2>
        <form className="form-grid" onSubmit={registrarAdelanto}>
          <label className="field">
            <span className="field-label">Monto (CRC)</span>
            <input
              type="number"
              min="0"
              step="0.01"
              value={monto}
              onChange={(e) => setMonto(e.target.value)}
              placeholder="50000"
              required
            />
          </label>
          <label className="field">
            <span className="field-label">Fecha de entrega</span>
            <input
              type="date"
              value={fecha}
              onChange={(e) => setFecha(e.target.value)}
              required
            />
          </label>
          <label className="field">
            <span className="field-label">Responsable</span>
            <input
              type="text"
              value={responsable}
              onChange={(e) => setResponsable(e.target.value)}
              placeholder="Nombre del responsable"
            />
          </label>
          <label className="field field-wide">
            <span className="field-label">Notas</span>
            <input
              type="text"
              value={notas}
              onChange={(e) => setNotas(e.target.value)}
              placeholder="Ej. Adelanto para gastos de oficina semana 2"
            />
          </label>
          <div className="form-actions">
            <button type="submit" className="btn btn-primary" disabled={enviando}>
              {enviando ? 'Registrando…' : 'Registrar adelanto'}
            </button>
            {exito && <span className="text-success">{exito}</span>}
          </div>
        </form>
      </section>

      <section className="card">
        <h2>Descargar Reintegro Caja Chica (Excel)</h2>
        <p className="muted">
          Genera el .xlsx oficial con formato Forward: una fila por (factura × tarifa de IVA),
          totales al pie y saldo líquido = adelantos abiertos − Σ facturas. El archivo
          contendrá las facturas del mes seleccionado.
        </p>
        <div className="filters">
          <label className="field field-inline">
            <span className="field-label">Mes del reporte</span>
            <input
              type="month"
              value={mesExcel}
              onChange={(e) => setMesExcel(e.target.value)}
            />
          </label>
          <span className="muted small">
            Reporte de <strong>{nombreMesLargo(mesExcel)}</strong>
          </span>
          <button
            type="button"
            className="btn btn-primary"
            disabled={descargando}
            onClick={descargarReintegro}
          >
            {descargando ? 'Generando…' : 'Descargar Excel'}
          </button>
        </div>
      </section>
    </div>
  );
}
