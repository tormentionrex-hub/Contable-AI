import { useState } from 'react';
import { api, ApiError } from '../lib/api.js';
import { useEmpresa, useEmpresaId } from '../lib/auth.js';
import {
  guardarArchivoEnCarpeta,
  tieneDirectoryPicker,
  GuardadoCanceladoError,
} from '../lib/save-file.js';
import { ConfirmDialog } from './ConfirmDialog.js';

interface LimpiarPanelProps {
  /** Texto del botón. Por default: "Limpiar". */
  label?: string;
  /** Hint corto que aparece al lado del botón. */
  descripcion?: string;
  /** Filtro de mes (YYYY-MM) si la página tiene scope mensual. */
  mes?: string;
  /** Si true, también archiva los adelantos de caja chica del período. */
  incluirAdelantos?: boolean;
  /** Texto del modal — describe qué se va a archivar ("las facturas de mayo", etc.) */
  alcance: string;
  /** Callback después de archivar exitoso, para que la página recargue. */
  onArchivado?: () => void;
}

type Fase = 'idle' | 'guardando' | 'confirmando' | 'archivando' | 'hecho' | 'error';

export function LimpiarPanel({
  label = 'Limpiar',
  descripcion,
  mes,
  incluirAdelantos = false,
  alcance,
  onArchivado,
}: LimpiarPanelProps) {
  const empresa = useEmpresa();
  const empresa_id = useEmpresaId();
  const [open, setOpen] = useState(false);
  const [guardarAntes, setGuardarAntes] = useState(true);
  const [fase, setFase] = useState<Fase>('idle');
  const [error, setError] = useState<string | null>(null);
  const [resultado, setResultado] = useState<{
    facturas: number;
    adelantos: number;
    ruta?: string;
  } | null>(null);

  function abrir(): void {
    setOpen(true);
    setFase('idle');
    setError(null);
    setResultado(null);
    setGuardarAntes(true);
  }

  function cerrar(): void {
    if (fase === 'guardando' || fase === 'archivando') return;
    setOpen(false);
  }

  async function ejecutar(): Promise<void> {
    setError(null);
    let rutaRespaldo: string | undefined;

    // Paso 1: si pidió respaldo, generar y guardar.
    if (guardarAntes) {
      setFase('guardando');
      try {
        const blob = await api.descargarRespaldoCompleto({
          empresa_id,
          mes,
        });
        const stamp = new Date().toISOString().slice(0, 10);
        const subcarpeta = `Respaldo-${empresa.id}-${stamp}`;
        const filename = `respaldo-completo-${empresa.id}-${stamp}.xlsx`;
        const { ruta } = await guardarArchivoEnCarpeta({
          blob,
          filename,
          subcarpeta: tieneDirectoryPicker() ? subcarpeta : undefined,
        });
        rutaRespaldo = ruta;
      } catch (err) {
        if (err instanceof GuardadoCanceladoError) {
          setError('Cancelaste el guardado. No se archivó nada.');
          setFase('idle');
          return;
        }
        setError(
          err instanceof ApiError
            ? err.humano
            : 'No se pudo generar el respaldo. La limpieza se canceló por seguridad.',
        );
        setFase('idle');
        return;
      }
    }

    // Paso 2: archivar en backend.
    setFase('archivando');
    try {
      const r = await api.archivarFacturas({
        mes,
        incluir_adelantos: incluirAdelantos,
      });
      setResultado({
        facturas: r.facturas_archivadas,
        adelantos: r.adelantos_archivados,
        ruta: rutaRespaldo,
      });
      setFase('hecho');
      onArchivado?.();
    } catch (err) {
      setError(err instanceof ApiError ? err.humano : 'Falló el archivado.');
      setFase('error');
    }
  }

  // Modal de "hecho" — pantalla final de éxito.
  if (open && fase === 'hecho' && resultado) {
    return (
      <>
        <button
          type="button"
          className="btn btn-ghost btn-sm btn-limpiar"
          onClick={abrir}
          title={descripcion ?? 'Archivar los registros visibles'}
        >
          {label}
        </button>
        <ConfirmDialog
          open
          variant="success"
          title="Limpieza completada"
          message={
            <>
              Se archivaron <strong>{resultado.facturas} facturas</strong>
              {resultado.adelantos > 0 && (
                <> y <strong>{resultado.adelantos} adelantos</strong></>
              )}.
              {resultado.ruta && (
                <>
                  <br />
                  El respaldo quedó guardado en <code>{resultado.ruta}</code>.
                </>
              )}
              <br />
              Los datos siguen disponibles en la sección <strong>Historial</strong>.
            </>
          }
          confirmText="Listo"
          cancelText="Cerrar"
          busy={false}
          onConfirm={() => setOpen(false)}
          onCancel={() => setOpen(false)}
        />
      </>
    );
  }

  return (
    <>
      <button
        type="button"
        className="btn btn-ghost btn-sm btn-limpiar"
        onClick={abrir}
        title={descripcion ?? 'Archivar los registros visibles. Guardás un respaldo Excel antes.'}
      >
        {label}
      </button>

      <ConfirmDialog
        open={open}
        variant="warning"
        title={fase === 'error' ? 'Algo salió mal' : '¿Limpiar estos registros?'}
        message={
          <div style={{ textAlign: 'left' }}>
            <p style={{ margin: '0 0 12px' }}>
              Vas a archivar <strong>{alcance}</strong>. Los registros desaparecen de las
              pantallas normales pero quedan disponibles en <strong>Historial</strong> y los
              podés restaurar cuando quieras.
            </p>

            <label className="sa-checkbox-row">
              <input
                type="checkbox"
                checked={guardarAntes}
                onChange={(e) => setGuardarAntes(e.target.checked)}
                disabled={fase !== 'idle' && fase !== 'error'}
              />
              <span>
                Guardar un Excel de respaldo antes (recomendado).{' '}
                {tieneDirectoryPicker() ? (
                  <em className="muted small">Vas a poder elegir la carpeta destino.</em>
                ) : (
                  <em className="muted small">Se descarga a la carpeta de Descargas de tu navegador.</em>
                )}
              </span>
            </label>

            {fase === 'guardando' && (
              <div className="alert alert-info" style={{ marginTop: 12 }}>
                Generando el Excel de respaldo…
              </div>
            )}
            {fase === 'archivando' && (
              <div className="alert alert-info" style={{ marginTop: 12 }}>
                Archivando registros…
              </div>
            )}
            {error && (
              <div className="alert alert-error" style={{ marginTop: 12 }}>
                {error}
              </div>
            )}
          </div>
        }
        confirmText={
          fase === 'guardando'
            ? 'Guardando…'
            : fase === 'archivando'
              ? 'Archivando…'
              : 'Sí, limpiar'
        }
        cancelText="Cancelar"
        busy={fase === 'guardando' || fase === 'archivando'}
        onConfirm={() => void ejecutar()}
        onCancel={cerrar}
      />
    </>
  );
}
