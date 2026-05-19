import { createRequire } from 'node:module';

const require_ = createRequire(import.meta.url);
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
}

const MIN_CHARS_FOR_NATIVE = 50;

export async function extractPdfText(buffer: Buffer): Promise<PdfExtractResult> {
  let text = '';
  let numPages = 0;
  try {
    const result = await pdfParse(buffer);
    text = (result.text ?? '').trim();
    numPages = result.numpages;
  } catch {
    // PDF corrupto o sin texto extraíble — tratamos como escaneado.
    return { text: '', numPages: 0, isScanned: true };
  }
  // Heurística simple: si pdf-parse pudo sacar >= 50 caracteres, lo consideramos nativo.
  // El asciiRatio anterior fallaba con textos en español (tildes y caracteres extendidos)
  // — marcaba como "escaneado" facturas que en realidad eran texto extraíble y activaba
  // Vision innecesariamente. Si en producción aparece un escaneado real, vendrá con muy
  // poco texto (< 50 chars) y la heurística simple lo detecta igual.
  const isScanned = text.length < MIN_CHARS_FOR_NATIVE;
  return { text, numPages, isScanned };
}
