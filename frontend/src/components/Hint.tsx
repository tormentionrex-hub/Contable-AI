import { useState, useId, type ReactNode } from 'react';

interface HintProps {
  children: ReactNode;
  label?: string;
  position?: 'top' | 'bottom' | 'left' | 'right';
  size?: 'sm' | 'md';
}

/**
 * Tooltip de ayuda con ícono "?". Pensado para contadores no técnicos:
 * - Se abre con hover (mouse) o foco (teclado).
 * - El contenido aparece arriba por default y se acomoda a los costados.
 * - Accesible: aria-describedby + role="tooltip".
 */
export function Hint({ children, label = 'Más información', position = 'top', size = 'md' }: HintProps) {
  const id = useId();
  const [open, setOpen] = useState(false);

  return (
    <span className={`hint hint-${size}`}>
      <button
        type="button"
        className="hint-trigger"
        aria-label={label}
        aria-describedby={open ? id : undefined}
        aria-expanded={open}
        onMouseEnter={() => setOpen(true)}
        onMouseLeave={() => setOpen(false)}
        onFocus={() => setOpen(true)}
        onBlur={() => setOpen(false)}
        onClick={(e) => {
          e.preventDefault();
          e.stopPropagation();
          setOpen((v) => !v);
        }}
      >
        ?
      </button>
      {open && (
        <span id={id} role="tooltip" className={`hint-bubble hint-bubble-${position}`}>
          {children}
        </span>
      )}
    </span>
  );
}
