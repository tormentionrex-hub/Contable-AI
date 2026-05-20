import { useEffect, useRef, type ReactNode } from 'react';

export type ConfirmVariant = 'success' | 'warning' | 'danger' | 'info';

interface ConfirmDialogProps {
  open: boolean;
  variant?: ConfirmVariant;
  title: string;
  message: ReactNode;
  confirmText?: string;
  cancelText?: string;
  onConfirm: () => void;
  onCancel: () => void;
  busy?: boolean;
}

/**
 * Modal de confirmación estilo SweetAlert con la paleta Forward:
 * - Overlay oscuro semitransparente que cierra al hacer clic fuera.
 * - Tarjeta centrada con icono circular grande arriba.
 * - Botón principal coloreado según la variante (verde/ámbar/rojo/azul).
 * - Tecla Escape cancela, Enter confirma.
 * - Foco automático en el botón de confirmar.
 *
 * No usa librerías externas — implementación pura React + CSS.
 */
export function ConfirmDialog({
  open,
  variant = 'success',
  title,
  message,
  confirmText = 'Sí, confirmar',
  cancelText = 'Cancelar',
  onConfirm,
  onCancel,
  busy = false,
}: ConfirmDialogProps) {
  const confirmBtnRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!open) return;
    // Foco al botón de confirmar al abrir.
    const t = setTimeout(() => confirmBtnRef.current?.focus(), 50);

    // Atajos de teclado.
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape' && !busy) {
        e.preventDefault();
        onCancel();
      } else if (e.key === 'Enter' && !busy) {
        e.preventDefault();
        onConfirm();
      }
    }
    window.addEventListener('keydown', onKey);
    document.body.style.overflow = 'hidden';

    return () => {
      clearTimeout(t);
      window.removeEventListener('keydown', onKey);
      document.body.style.overflow = '';
    };
  }, [open, busy, onConfirm, onCancel]);

  if (!open) return null;

  return (
    <div
      className="sa-overlay"
      onClick={(e) => {
        if (e.target === e.currentTarget && !busy) onCancel();
      }}
      role="presentation"
    >
      <div
        className={`sa-card sa-${variant}`}
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="sa-title"
        aria-describedby="sa-message"
      >
        <div className="sa-icon" aria-hidden="true">
          {variant === 'success' && (
            <svg viewBox="0 0 60 60" width="60" height="60">
              <circle cx="30" cy="30" r="26" className="sa-icon-ring" />
              <path
                d="M18 31 L27 40 L43 22"
                className="sa-icon-mark"
                fill="none"
              />
            </svg>
          )}
          {variant === 'warning' && (
            <svg viewBox="0 0 60 60" width="60" height="60">
              <circle cx="30" cy="30" r="26" className="sa-icon-ring" />
              <path d="M30 16 L30 36" className="sa-icon-mark" fill="none" />
              <circle cx="30" cy="43" r="2.5" className="sa-icon-dot" />
            </svg>
          )}
          {variant === 'danger' && (
            <svg viewBox="0 0 60 60" width="60" height="60">
              <circle cx="30" cy="30" r="26" className="sa-icon-ring" />
              <path d="M20 20 L40 40 M40 20 L20 40" className="sa-icon-mark" fill="none" />
            </svg>
          )}
          {variant === 'info' && (
            <svg viewBox="0 0 60 60" width="60" height="60">
              <circle cx="30" cy="30" r="26" className="sa-icon-ring" />
              <path d="M30 27 L30 43" className="sa-icon-mark" fill="none" />
              <circle cx="30" cy="20" r="2.5" className="sa-icon-dot" />
            </svg>
          )}
        </div>

        <h2 id="sa-title" className="sa-title">
          {title}
        </h2>
        <div id="sa-message" className="sa-message">
          {message}
        </div>

        <div className="sa-actions">
          <button
            type="button"
            className="sa-btn sa-btn-cancel"
            onClick={onCancel}
            disabled={busy}
          >
            {cancelText}
          </button>
          <button
            ref={confirmBtnRef}
            type="button"
            className={`sa-btn sa-btn-confirm sa-btn-${variant}`}
            onClick={onConfirm}
            disabled={busy}
          >
            {busy ? 'Guardando…' : confirmText}
          </button>
        </div>
      </div>
    </div>
  );
}
