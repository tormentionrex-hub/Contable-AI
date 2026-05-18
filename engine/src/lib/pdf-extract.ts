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
  /** True si el PDF parece escaneado (texto extraído insuficiente o basura OCR). */
  isScanned: boolean;
}

const MIN_CHARS_FOR_NATIVE = 50;
const MIN_ASCII_RATIO = 0.7;

function asciiRatio(text: string): number {
  if (text.length === 0) return 1;
  let printable = 0;
  for (let i = 0; i < text.length; i++) {
    const c = text.charCodeAt(i);
    // ASCII imprimible + saltos de línea + tildes UTF-8 básicas (rango latín).
    if ((c >= 0x20 && c <= 0x7e) || c === 0x09 || c === 0x0a || c === 0x0d || (c >= 0xa0 && c <= 0xff)) {
      printable++;
    }
  }
  return printable / text.length;
}

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
  const isScanned = text.length < MIN_CHARS_FOR_NATIVE || asciiRatio(text) < MIN_ASCII_RATIO;
  return { text, numPages, isScanned };
}
