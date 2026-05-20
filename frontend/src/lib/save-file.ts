/**
 * Helper para guardar archivos en el disco del usuario.
 *
 * Estrategia híbrida:
 *  - Chrome/Edge (basados en Chromium): usa `window.showSaveFilePicker` o
 *    `showDirectoryPicker` para que el contador elija la carpeta destino.
 *    Permite crear subcarpetas tipo "Respaldo-2026-05-20".
 *  - Resto (Firefox/Safari): cae al método tradicional con un <a download>
 *    que descarga al directorio Descargas del navegador.
 *
 * Funcionalmente equivalente: el archivo siempre llega al disco. La única
 * diferencia es UX: en Chromium el contador elige la carpeta, en otros
 * navegadores Firefox/Safari elige donde guardar a través del diálogo nativo
 * del navegador (que cada uno configura como prefiera).
 */

export function tieneFileSystemAccess(): boolean {
  return typeof window !== 'undefined' && 'showSaveFilePicker' in window;
}

export function tieneDirectoryPicker(): boolean {
  return typeof window !== 'undefined' && 'showDirectoryPicker' in window;
}

interface SavePickerOpts {
  blob: Blob;
  suggestedName: string;
  mime?: string;
  description?: string;
}

/**
 * Guarda un blob preguntando dónde con `showSaveFilePicker` si está
 * disponible. Si no, cae a descarga tradicional.
 */
export async function guardarArchivoConDialogo(opts: SavePickerOpts): Promise<void> {
  const mime = opts.mime ?? 'application/octet-stream';

  if (tieneFileSystemAccess()) {
    try {
      // @ts-expect-error — TS no incluye los tipos de File System Access API en lib.dom por default.
      const handle = await window.showSaveFilePicker({
        suggestedName: opts.suggestedName,
        types: [
          {
            description: opts.description ?? 'Archivo',
            accept: { [mime]: ['.' + opts.suggestedName.split('.').pop()] },
          },
        ],
      });
      const writable = await handle.createWritable();
      await writable.write(opts.blob);
      await writable.close();
      return;
    } catch (err) {
      if (err instanceof DOMException && err.name === 'AbortError') {
        // Usuario canceló — no es error.
        throw new GuardadoCanceladoError();
      }
      // Cualquier otro error en File System Access → fallback.
      // eslint-disable-next-line no-console
      console.warn('showSaveFilePicker falló, fallback a descarga directa', err);
    }
  }

  // Fallback: descarga tradicional al directorio Descargas del navegador.
  const url = URL.createObjectURL(opts.blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = opts.suggestedName;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 0);
}

/**
 * Pide al usuario una carpeta y guarda el blob adentro con el nombre dado.
 * Si la API no está disponible, cae a `guardarArchivoConDialogo`.
 */
export async function guardarArchivoEnCarpeta(opts: {
  blob: Blob;
  filename: string;
  subcarpeta?: string;
}): Promise<{ ruta: string }> {
  if (!tieneDirectoryPicker()) {
    await guardarArchivoConDialogo({
      blob: opts.blob,
      suggestedName: opts.filename,
      mime: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      description: 'Excel',
    });
    return { ruta: opts.filename };
  }
  try {
    // @ts-expect-error — File System Access API
    const dirHandle = await window.showDirectoryPicker({ mode: 'readwrite' });
    let targetDir = dirHandle;
    if (opts.subcarpeta) {
      targetDir = await dirHandle.getDirectoryHandle(opts.subcarpeta, { create: true });
    }
    const fileHandle = await targetDir.getFileHandle(opts.filename, { create: true });
    const writable = await fileHandle.createWritable();
    await writable.write(opts.blob);
    await writable.close();
    const ruta = opts.subcarpeta ? `${opts.subcarpeta}/${opts.filename}` : opts.filename;
    return { ruta };
  } catch (err) {
    if (err instanceof DOMException && err.name === 'AbortError') {
      throw new GuardadoCanceladoError();
    }
    // eslint-disable-next-line no-console
    console.warn('showDirectoryPicker falló, fallback a descarga directa', err);
    await guardarArchivoConDialogo({
      blob: opts.blob,
      suggestedName: opts.filename,
      mime: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      description: 'Excel',
    });
    return { ruta: opts.filename };
  }
}

export class GuardadoCanceladoError extends Error {
  constructor() {
    super('Guardado cancelado por el usuario');
    this.name = 'GuardadoCanceladoError';
  }
}
