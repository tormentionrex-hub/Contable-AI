/**
 * Splitter de PDFs multi-factura.
 *
 * Estrategia:
 *  1. Extraer texto del PDF página por página con `pdf-parse` (heurística sobre el `text`
 *     post-procesado: pdf-parse expone `numpages` y el texto concatenado con \f como
 *     separador de página en versiones recientes; lo desempaquetamos manualmente con
 *     `pdfjs-dist` no — usamos `pdf-lib` para obtener el conteo y vamos página a página).
 *  2. Para cada página, marcar si "inicia una factura" usando heurísticas robustas:
 *       - aparece una clave numérica de 50 dígitos (FE Hacienda)
 *       - aparece el texto "Factura Electrónica" / "FACTURA ELECTRONICA" / "Tiquete Electrónico"
 *       - aparece un logo/encabezado de proveedor reconocido (PRICESMART, PEQUEÑO MUNDO, etc.)
 *       - aparece un consecutivo nuevo (20 dígitos)
 *  3. Cortar el PDF en sub-PDFs con `pdf-lib`, agrupando páginas hasta el siguiente "inicio".
 *  4. Si solo se detecta 1 inicio → devolver [bufferOriginal] (no se rompe el caso de Fase 1).
 */

import { PDFDocument } from 'pdf-lib';
import { createRequire } from 'node:module';
import { logger } from './logger.js';

const log = logger.child({ mod: 'pdf-split' });

const require_ = createRequire(import.meta.url);
// eslint-disable-next-line @typescript-eslint/no-var-requires
const pdfParse: (data: Buffer, opts?: { max?: number; pagerender?: (data: any) => Promise<string> }) => Promise<{
  numpages: number;
  text: string;
}> = require_('pdf-parse/lib/pdf-parse.js');

export class SplitterError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SplitterError';
  }
}

const RX_CLAVE_50 = /\b\d{50}\b/g;
const RX_CONSECUTIVO_20 = /\b\d{20}\b/g;
const RX_FACTURA_KEY = /(Factura\s+Electr[oó]nica|FACTURA\s+ELECTR[OÓ]NICA|Tiquete\s+Electr[oó]nico|TIQUETE\s+ELECTR[OÓ]NICO)/i;
const RX_PROVEEDOR_HINT = /(PRICESMART|PEQUE[NÑ]O\s+MUNDO|ALPEMUSA|CORPORACI[OÓ]N\s+SUPERMERCADOS\s+UNIDOS|ALMACENES\s+EL\s+REY|MARKET\s+R[IÍ]O\s+ORO)/i;

interface PaginaAnalisis {
  numero: number;
  texto: string;
  claves: string[];
  consecutivos: string[];
  inicioFactura: boolean;
  proveedorHint: string | null;
}

async function analizarPaginas(buffer: Buffer): Promise<PaginaAnalisis[]> {
  // pdf-parse no expone páginas individuales por default. Usamos un pagerender custom
  // que captura el texto de cada página.
  const paginas: PaginaAnalisis[] = [];
  // Cargamos también el doc con pdf-lib para fallback de conteo.
  const pdfDoc = await PDFDocument.load(buffer, { ignoreEncryption: true });
  const total = pdfDoc.getPageCount();

  // Recolectamos texto página por página con pagerender (corre por cada página).
  let paginaIdx = 0;
  await pdfParse(buffer, {
    pagerender: async (pageData: any) => {
      const textContent = await pageData.getTextContent();
      const items = (textContent.items ?? []) as Array<{ str: string }>;
      const texto = items.map((it) => it.str).join(' ');
      paginas.push(analizarTexto(paginaIdx + 1, texto));
      paginaIdx += 1;
      return texto;
    },
  });

  // Fallback: si pdf-parse no llenó todas las páginas, completamos con texto vacío.
  while (paginas.length < total) {
    paginas.push(analizarTexto(paginas.length + 1, ''));
  }
  return paginas;
}

function analizarTexto(numero: number, texto: string): PaginaAnalisis {
  const claves = (texto.match(RX_CLAVE_50) ?? []).filter((c) => c.length === 50);
  const consecutivos = (texto.match(RX_CONSECUTIVO_20) ?? []).filter((c) => c.length === 20);
  const proveedorMatch = texto.match(RX_PROVEEDOR_HINT);
  const tieneKey = RX_FACTURA_KEY.test(texto);
  const inicioFactura = claves.length > 0 || (tieneKey && proveedorMatch !== null);
  return {
    numero,
    texto,
    claves,
    consecutivos,
    inicioFactura,
    proveedorHint: proveedorMatch?.[0] ?? null,
  };
}

/**
 * Dado un PDF que puede contener varias facturas (caso "Caja Chica Santa Ana"),
 * devuelve un array de buffers, uno por sub-factura detectada.
 *
 * Si solo detecta 1 inicio (o 0), devuelve [bufferOriginal] sin tocarlo.
 */
export async function splitMultiInvoicePdf(buffer: Buffer): Promise<Buffer[]> {
  let paginas: PaginaAnalisis[];
  try {
    paginas = await analizarPaginas(buffer);
  } catch (err) {
    throw new SplitterError(`No se pudo analizar el PDF: ${(err as Error).message}`);
  }

  // Agrupar páginas en rangos. Una nueva factura empieza donde `inicioFactura` es true
  // o donde cambia el "proveedorHint" respecto al rango anterior.
  const grupos: Array<{ desde: number; hasta: number; clave?: string; proveedor?: string | null }> = [];
  let actual: { desde: number; hasta: number; clave?: string; proveedor?: string | null } | null = null;

  for (const p of paginas) {
    const debeArrancar =
      p.inicioFactura ||
      (actual !== null &&
        p.proveedorHint !== null &&
        actual.proveedor !== null &&
        actual.proveedor !== undefined &&
        p.proveedorHint !== actual.proveedor);

    if (!actual || debeArrancar) {
      if (actual) grupos.push(actual);
      actual = {
        desde: p.numero,
        hasta: p.numero,
        clave: p.claves[0],
        proveedor: p.proveedorHint,
      };
    } else {
      actual.hasta = p.numero;
      if (!actual.clave && p.claves[0]) actual.clave = p.claves[0];
      if (!actual.proveedor && p.proveedorHint) actual.proveedor = p.proveedorHint;
    }
  }
  if (actual) grupos.push(actual);

  if (grupos.length <= 1) {
    log.debug('Splitter: 1 sola factura detectada', { paginas: paginas.length });
    return [buffer];
  }

  log.info('Splitter detectó múltiples facturas', {
    total: grupos.length,
    detalle: grupos.map((g) => `p${g.desde}-${g.hasta}:${g.proveedor ?? '?'}`).join(' | '),
  });

  // Cortar el PDF en sub-PDFs con pdf-lib.
  const original = await PDFDocument.load(buffer, { ignoreEncryption: true });
  const subPdfs: Buffer[] = [];

  for (const g of grupos) {
    const sub = await PDFDocument.create();
    const indices: number[] = [];
    for (let i = g.desde; i <= g.hasta; i++) indices.push(i - 1);
    const copied = await sub.copyPages(original, indices);
    copied.forEach((p) => sub.addPage(p));
    const bytes = await sub.save();
    subPdfs.push(Buffer.from(bytes));
  }

  return subPdfs;
}
