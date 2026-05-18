import { createSubagent, defaultSkillPath, type Subagent } from './claude.js';
import { extractPdfText } from '../lib/pdf-extract.js';
import { parseHaciendaXML } from '../lib/xml-parse.js';
import { validateFactura, getSchema } from '../lib/validator.js';
import { FacturaInvalidaError, AgenteFalloError, ArchivoInvalidoError } from '../lib/errors.js';
import type { FacturaSchemaJson } from '../types/factura.js';
import { logger } from '../lib/logger.js';

let _agent: Subagent | null = null;
function getAgent(): Subagent {
  if (!_agent) {
    _agent = createSubagent({ name: 'docscan', skillPath: defaultSkillPath('docscan.md') });
  }
  return _agent;
}

export interface ExtractInput {
  buffer: Buffer;
  mimeType: string;
  filename: string;
}

const log = logger.child({ agente: 'docscan' });

/**
 * Extrae una factura desde un PDF nativo, PDF escaneado o XML Hacienda.
 * Devuelve un objeto que matchea `factura.schema.json` y ya viene validado.
 */
export async function extractFactura(input: ExtractInput): Promise<FacturaSchemaJson> {
  const agent = getAgent();
  const schema = getSchema();

  let userPrompt: string;
  let fuenteSugerida: 'pdf_nativo' | 'pdf_escaneado' | 'xml_hacienda';

  if (input.mimeType === 'application/xml' || input.mimeType === 'text/xml' || input.filename.toLowerCase().endsWith('.xml')) {
    const xmlText = input.buffer.toString('utf8');
    const parsed = parseHaciendaXML(xmlText);
    fuenteSugerida = 'xml_hacienda';
    userPrompt = buildXmlPrompt({
      filename: input.filename,
      parsedJson: parsed.raw,
      tipoDocumento: parsed.tipoDocumento,
      version: parsed.version,
      rawXml: xmlText,
    });
  } else if (input.mimeType === 'application/pdf' || input.filename.toLowerCase().endsWith('.pdf')) {
    const pdf = await extractPdfText(input.buffer);
    if (pdf.isScanned) {
      // TODO(fase-1): para escaneados reales necesitaremos enviar el PDF como
      // adjunto (content block `document`). Por ahora intentamos con el poco
      // texto que haya y dejamos que el modelo marque OCR_DEGRADADO si no puede.
      fuenteSugerida = 'pdf_escaneado';
      log.warn('PDF escaneado o sin texto extraíble', {
        filename: input.filename,
        textLength: pdf.text.length,
      });
    } else {
      fuenteSugerida = 'pdf_nativo';
    }
    userPrompt = buildPdfPrompt({
      filename: input.filename,
      pdfText: pdf.text,
      numPages: pdf.numPages,
      isScanned: pdf.isScanned,
    });
  } else {
    throw new ArchivoInvalidoError(
      `Tipo de archivo no soportado: ${input.mimeType}. Solo PDF o XML.`,
      { mimeType: input.mimeType, filename: input.filename },
    );
  }

  const { output, durationMs } = await agent.run<unknown>({
    prompt: userPrompt,
    outputSchema: schema,
    maxTurns: 3,
  });

  log.info('Extracción terminada', { filename: input.filename, durationMs });

  const validation = validateFactura(output);
  if (!validation.valid) {
    throw new FacturaInvalidaError(
      'El JSON devuelto por DocScan no cumple el schema',
      {
        errors: validation.errors,
        errorsText: validation.errorsText,
        payload: output,
      },
    );
  }

  const factura = output as FacturaSchemaJson;

  // Coherencia: la fuente declarada por el agente debería matchear la sugerida.
  if (factura.fuente !== fuenteSugerida) {
    log.warn('Discrepancia en fuente declarada vs sugerida', {
      declarada: factura.fuente,
      sugerida: fuenteSugerida,
    });
  }

  return factura;
}

function buildPdfPrompt(args: {
  filename: string;
  pdfText: string;
  numPages: number;
  isScanned: boolean;
}): string {
  return [
    `Estás procesando una factura costarricense.`,
    `Archivo: ${args.filename}`,
    `Páginas: ${args.numPages}`,
    `Fuente probable: ${args.isScanned ? 'pdf_escaneado' : 'pdf_nativo'}`,
    ``,
    `Aplicá las reglas por dialecto de tu skill. Detectá el proveedor por el logo/encabezado del texto y elegí el dialecto correcto.`,
    ``,
    `Si el texto contiene VARIAS facturas (por ejemplo un "Reintegro de Caja Chica" con múltiples comprobantes consecutivos), elegí la PRIMERA factura completa que aparezca y extraela. Documentalo en \`motivo_revision: null\` pero con \`confianza_extraccion <= 0.7\`. Si no podés separar, marcá \`requiere_revision_humana: true\` con motivo \`OCR_DEGRADADO\`.`,
    ``,
    `Devolvé EXCLUSIVAMENTE el JSON que matchea factura.schema.json, sin texto adicional.`,
    ``,
    `=== TEXTO EXTRAÍDO DEL PDF ===`,
    args.pdfText.length > 0 ? args.pdfText : '(vacío — PDF probablemente escaneado)',
    `=== FIN TEXTO ===`,
  ].join('\n');
}

function buildXmlPrompt(args: {
  filename: string;
  parsedJson: unknown;
  tipoDocumento: string | null;
  version: string | null;
  rawXml: string;
}): string {
  // Si el XML es chico, le pasamos también el crudo para verificación; si es enorme, solo el JSON parseado.
  const xmlChunk = args.rawXml.length < 50_000 ? args.rawXml : `(XML muy grande — usá la representación JSON parseada)`;
  return [
    `Estás procesando un XML de factura electrónica de Hacienda CR.`,
    `Archivo: ${args.filename}`,
    `Tipo detectado: ${args.tipoDocumento ?? 'desconocido'}`,
    `Versión detectada: ${args.version ?? 'desconocida'}`,
    ``,
    `Devolvé EXCLUSIVAMENTE el JSON que matchea factura.schema.json. fuente="xml_hacienda".`,
    ``,
    `=== JSON PARSEADO ===`,
    JSON.stringify(args.parsedJson, null, 2),
    `=== XML CRUDO ===`,
    xmlChunk,
    `=== FIN ===`,
  ].join('\n');
}

export function _resetAgent(): void {
  _agent = null;
}
