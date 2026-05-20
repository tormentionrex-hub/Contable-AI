import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { createSubagent, defaultSkillPath, type Subagent } from './claude.js';
import { extractPdfText } from '../lib/pdf-extract.js';
import { parseHaciendaXML } from '../lib/xml-parse.js';
import { validateFactura, getSchema } from '../lib/validator.js';
import { FacturaInvalidaError, AgenteFalloError, ArchivoInvalidoError } from '../lib/errors.js';
import type { FacturaSchemaJson } from '../types/factura.js';
import { logger } from '../lib/logger.js';
import { config } from '../config.js';

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
      fuenteSugerida = 'pdf_escaneado';
      log.warn('PDF escaneado o sin texto extraíble — usando Vision', {
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

  // Si es PDF escaneado, guardamos el buffer en un archivo temporal y le habilitamos
  // a DocScan la herramienta `Read` para que el modelo lea el PDF directamente (Vision).
  let extraOpts: { builtinTools?: string[]; additionalDirectories?: string[] } = {};
  let tempPdfPath: string | null = null;
  if (
    fuenteSugerida === 'pdf_escaneado' &&
    (input.mimeType === 'application/pdf' || input.filename.toLowerCase().endsWith('.pdf'))
  ) {
    if (!fs.existsSync(config.paths.uploads)) {
      fs.mkdirSync(config.paths.uploads, { recursive: true });
    }
    tempPdfPath = path.join(config.paths.uploads, `scan-${randomUUID()}.pdf`);
    fs.writeFileSync(tempPdfPath, input.buffer);
    extraOpts = {
      builtinTools: ['Read'],
      additionalDirectories: [config.paths.uploads, config.paths.projectRoot],
    };
    userPrompt = `${userPrompt}\n\n=== ARCHIVO LOCAL ===\nEl PDF está en ${tempPdfPath}. Usá la herramienta Read con ese path absoluto para verlo con Vision si el texto extraído arriba es vacío o ilegible.\n=== FIN ===`;
  }

  const { output, durationMs } = await agent.run<unknown>({
    prompt: userPrompt,
    outputSchema: schema,
    maxTurns: fuenteSugerida === 'pdf_escaneado' ? 5 : 3,
    ...extraOpts,
  });

  // Cleanup del temp del escaneado.
  if (tempPdfPath) {
    try {
      fs.unlinkSync(tempPdfPath);
    } catch {
      /* ignore */
    }
  }

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

  // Red de seguridad post-extracción: si la fecha es obviamente inválida
  // (futura o muy vieja), forzamos revisión humana. Sirve como salvavidas si
  // el agente se equivocó leyendo dígitos parecidos (3/8, 1/7) o si un OCR
  // degradado dio un día corrido.
  validarFechaSospechosa(factura, log);

  return factura;
}

function validarFechaSospechosa(factura: FacturaSchemaJson, log: typeof logger): void {
  const iso = factura.factura?.fecha_emision;
  if (!iso || typeof iso !== 'string') return;
  const match = iso.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return;

  const [, y, m, d] = match;
  const fechaFactura = new Date(`${iso}T12:00:00`);
  const hoy = new Date();
  const diffDias = (fechaFactura.getTime() - hoy.getTime()) / 86_400_000;

  let motivo: 'FECHA_FUTURA' | 'FECHA_MUY_VIEJA' | 'FECHA_INVALIDA' | null = null;
  if (diffDias > 1) {
    motivo = 'FECHA_FUTURA';
  } else if (diffDias < -365 * 5) {
    motivo = 'FECHA_MUY_VIEJA';
  } else if (Number(m) < 1 || Number(m) > 12 || Number(d) < 1 || Number(d) > 31) {
    motivo = 'FECHA_INVALIDA';
  }

  if (motivo) {
    log.warn('Fecha sospechosa detectada, forzando revisión humana', {
      fecha_emision: iso,
      motivo,
      diff_dias: Math.round(diffDias),
    });
    factura.requiere_revision_humana = true;
    if (!factura.motivo_revision) {
      factura.motivo_revision = motivo;
    }
    if (factura.confianza_extraccion > 0.7) {
      factura.confianza_extraccion = 0.7;
    }
  }
  void y;
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
    `## RECORDATORIO CRÍTICO`,
    ``,
    `Esta extracción alimenta una declaración fiscal real. PROHIBIDO inventar datos`,
    `identificatorios y monetarios (fechas, montos, cédulas, nombres, clave numérica).`,
    ``,
    `- Esos campos DEBEN estar escritos literalmente en la factura. Si no aparecen → \`null\`.`,
    `- Las fechas se copian LITERALMENTE como están en el documento. No las recalcules.`,
    `  Formato CR: dd/mm/yyyy. Convertir a YYYY-MM-DD sin alterar día/mes/año.`,
    `- Antes de devolver el JSON, releé la factura UNA SEGUNDA VEZ y confirmá:`,
    `  fecha, total, cédula, proveedor, número de líneas y consecutivo coinciden.`,
    `- Si algo no se lee con claridad, marcá \`requiere_revision_humana: true\``,
    `  con el motivo apropiado en vez de adivinar.`,
    ``,
    `IMPORTANTE — \`tarifa_iva_marcada\` no es un campo identificatorio: es TRANSCRIPCIÓN`,
    `de la tarifa visible en la factura. Si ves cualquier marca de tarifa (columna %,`,
    `texto "IVA 13%", letra G/P/M/S/E al final de la línea, columna IMP con número),`,
    `copiala. Solo dejá \`tarifa_iva_marcada: null\` cuando la columna está vacía (caso`,
    `CSU) y Tax-IVA infiere después. NO devuelvas null si la tarifa está visible.`,
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
    `## RECORDATORIO CRÍTICO`,
    ``,
    `El XML es la fuente más confiable. No inventes ni recalcules nada.`,
    `- \`FechaEmision\` viene como ISO 8601 con offset, p.ej. \`2026-05-23T10:00:00-06:00\`.`,
    `  Tomá los primeros 10 caracteres (\`2026-05-23\`) como \`fecha_emision\`. NO conviertas`,
    `  a UTC ni a otra zona. La parte calendario es la oficial.`,
    `- Si el XML trae \`tipoCambio: 1\` y la moneda es CRC, copialo. Si la moneda es USD/EUR,`,
    `  setealo en \`null\` y dejá que Tax-IVA consulte Hacienda.`,
    `- Si un campo del schema no existe en el XML → \`null\`. No completes con valores`,
    `  inferidos del nombre del archivo ni de tu memoria.`,
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
