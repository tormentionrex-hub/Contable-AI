// `pdf-parse` no expone tipos completos; usamos require dinámico para evitar el side-effect
// del index (que lee un PDF de prueba al importar el módulo).
import { createRequire } from 'node:module';

const require_ = createRequire(import.meta.url);
// Import directo a `lib/pdf-parse.js` evita el shim de debug del módulo.
// eslint-disable-next-line @typescript-eslint/no-var-requires
const pdfParse: (data: Buffer) => Promise<{ numpages: number; text: string; info: unknown }> =
  require_('pdf-parse/lib/pdf-parse.js');

export interface PdfExtractResult {
  /** Texto extraído crudo (puede traer saltos de línea raros). */
  text: string;
  /** Cantidad de páginas detectadas. */
  numPages: number;
  /** True si el PDF parece escaneado (texto extraído insuficiente). */
  isScanned: boolean;
  /**
   * En Fase 1 no convertimos páginas a base64 PNG (requeriría pdf2img/pdf-poppler).
   * Si `isScanned === true`, el orquestador debe pasar el PDF original a Claude
   * vía un content-block tipo `document` (visión nativa) en lugar de texto.
   */
  base64Pages: string[];
}

const MIN_CHARS_FOR_NATIVE = 50;

export async function extractPdfText(buffer: Buffer): Promise<PdfExtractResult> {
  const result = await pdfParse(buffer);
  const text = (result.text ?? '').trim();
  const isScanned = text.length < MIN_CHARS_FOR_NATIVE;
  return {
    text,
    numPages: result.numpages,
    isScanned,
    // TODO(fase-1): si surge un PDF escaneado en producción, agregar pdf-img-convert
    // o pasar `application/pdf` como adjunto al agente. Por ahora dejamos vacío.
    base64Pages: [],
  };
}
