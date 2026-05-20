/**
 * Asistente Contable — sub-agente conversacional NL→SQL.
 *
 * Usa el skill `skills/asistente-contable.md` y los MCPs in-process:
 *   - fwd-db (SELECT-only)
 *   - hacienda-cr (TC, padrón, CABYS)
 *
 * Recibe un mensaje del contador y devuelve un texto en español de CR + auditoría
 * de qué SQL ejecutó. Persiste cada turno en `chat_history`.
 */

import { createSubagent, defaultSkillPath, type Subagent } from './claude.js';
import { buildHaciendaMcp } from './mcp/hacienda-cr.js';
import { buildFwdDbMcp } from './mcp/fwd-db.js';
import { getDb } from '../lib/db.js';
import { logger } from '../lib/logger.js';
import { AgenteFalloError } from '../lib/errors.js';

let _agent: Subagent | null = null;
function getAgent(): Subagent {
  if (!_agent) {
    _agent = createSubagent({
      name: 'asistente',
      skillPath: defaultSkillPath('asistente-contable.md'),
      mcpServers: {
        'fwd-db': buildFwdDbMcp(),
        'hacienda-cr': buildHaciendaMcp(),
      },
    });
  }
  return _agent;
}

const log = logger.child({ agente: 'asistente' });

export interface ChatInput {
  /** Mensaje del usuario en español. */
  mensaje: string;
  /** Empresa cliente activa (filtra todas las consultas SQL del agente). */
  empresa_id: string;
  /** ID del usuario que hace la consulta (para persistir en chat_history). */
  user_id: number | string;
  /** Historial reciente opcional (últimos N turnos) para contexto conversacional. */
  historial?: Array<{ rol: 'user' | 'assistant'; mensaje: string }>;
}

export interface ChatOutput {
  /** Texto de respuesta del asistente, en español de CR, listo para mostrar. */
  respuesta: string;
  /** SQL que el agente ejecutó (si lo hizo). Null si la pregunta no requirió DB. */
  sql_ejecutado: string | null;
  /** Filas que devolvió la query principal. */
  filas_devueltas: number;
  /** Costo en USD de esta turno (informativo, sin cargo extra con Max plan). */
  costo_usd: number;
  /** Duración en milisegundos. */
  duracion_ms: number;
}

const OUTPUT_SCHEMA: Record<string, unknown> = {
  type: 'object',
  required: ['respuesta'],
  properties: {
    respuesta: {
      type: 'string',
      description: 'Texto en español de Costa Rica, listo para mostrar al contador. Sin SQL ni jerga técnica.',
    },
    sql_ejecutado: {
      type: ['string', 'null'],
      description: 'SQL final que se ejecutó para obtener los datos (auditoría). Null si no se consultó la base.',
    },
    filas_devueltas: {
      type: ['integer', 'null'],
      description: 'Cantidad de filas devueltas por la query principal.',
    },
  },
};

export async function preguntar(input: ChatInput): Promise<ChatOutput> {
  const agent = getAgent();

  // Persistir el mensaje del usuario ANTES de procesar (para conservar la traza
  // aunque el agente falle a mitad).
  const db = getDb();
  db.prepare(
    `INSERT INTO chat_history (user_id, rol, mensaje) VALUES (?, 'user', ?)`,
  ).run(String(input.user_id), input.mensaje);

  const prompt = buildPrompt(input);
  const { output, durationMs, costUsd, rawText } = await agent.run<{
    respuesta?: string;
    sql_ejecutado?: string | null;
    filas_devueltas?: number | null;
  }>({
    prompt,
    outputSchema: OUTPUT_SCHEMA,
    maxTurns: 6, // permite que el agente haga query() + interprete + responda
  });

  const respuestaRaw = output?.respuesta?.trim() || rawText?.trim() || '';
  if (respuestaRaw.length === 0) {
    throw new AgenteFalloError('asistente', 'No se obtuvo respuesta del agente.');
  }
  // Red de seguridad: aunque el prompt prohíbe Markdown, los modelos a veces
  // se "olvidan" y meten **bold** o backticks. Limpiamos esos artefactos para
  // que el contador no vea sintaxis cruda.
  const respuesta = limpiarMarkdown(respuestaRaw);

  const sqlEjecutado = output?.sql_ejecutado ?? null;
  const filas = output?.filas_devueltas ?? 0;

  // Persistir respuesta.
  db.prepare(
    `INSERT INTO chat_history (user_id, rol, mensaje, sql_ejecutado, filas_devueltas)
     VALUES (?, 'assistant', ?, ?, ?)`,
  ).run(String(input.user_id), respuesta, sqlEjecutado, filas);

  log.info('Turno completado', { user_id: input.user_id, durationMs, costUsd });

  return {
    respuesta,
    sql_ejecutado: sqlEjecutado,
    filas_devueltas: filas,
    costo_usd: costUsd,
    duracion_ms: durationMs,
  };
}

/**
 * Limpia artefactos Markdown que el modelo pueda dejar en la respuesta.
 * El frontend muestra el texto plano y no parsea Markdown, así que ** se vería
 * como asteriscos literales. Sacamos:
 *  - **bold** y __bold__ → texto
 *  - *italic* y _italic_ → texto (cuidado con _ en medio de palabras)
 *  - `code` → texto
 *  - Bullets al principio de línea ("- ", "* ", "1. ") → texto sin marca
 */
function limpiarMarkdown(texto: string): string {
  return texto
    // Bold con asteriscos o guiones bajos dobles.
    .replace(/\*\*(.+?)\*\*/g, '$1')
    .replace(/__(.+?)__/g, '$1')
    // Italic con asteriscos o guiones bajos simples (evitando snake_case
    // pidiéndole letras/espacios alrededor del primer marcador).
    .replace(/(^|[\s(])\*([^*\n]+?)\*(?=[\s),.!?:;]|$)/g, '$1$2')
    .replace(/(^|[\s(])_([^_\n]+?)_(?=[\s),.!?:;]|$)/g, '$1$2')
    // Inline code con backticks simples o triples.
    .replace(/```[\s\S]*?```/g, '')
    .replace(/`([^`\n]+?)`/g, '$1')
    // Bullets al inicio de línea: "- foo" / "* foo" / "1. foo".
    .replace(/^[\t ]*[-*][\t ]+/gm, '')
    .replace(/^[\t ]*\d+\.[\t ]+/gm, '')
    // Encabezados Markdown: "# foo", "## foo".
    .replace(/^#{1,6}[\t ]+/gm, '')
    // Normalizar espacios en exceso al final de cada línea.
    .replace(/[\t ]+$/gm, '')
    .trim();
}

function buildPrompt(input: ChatInput): string {
  const hoy = new Date().toISOString().slice(0, 10);
  const histTexto =
    input.historial && input.historial.length > 0
      ? input.historial
          .map((h) => `${h.rol === 'user' ? 'Contador' : 'Asistente'}: ${h.mensaje}`)
          .join('\n')
      : '(primer turno)';

  return [
    `Sos el Asistente Contable de FWD Contable AI. Hablás con un contador de Forward Costa Rica.`,
    ``,
    `Fecha de hoy: ${hoy}.`,
    `Empresa activa: ${input.empresa_id}. TODAS tus queries SQL deben filtrar por empresa_id = '${input.empresa_id}'.`,
    ``,
    `Reglas técnicas:`,
    `- Para consultar la base, usá la herramienta mcp__fwd-db__query con una sentencia SELECT.`,
    `- Si dudás del nombre de una columna o tabla, usá primero mcp__fwd-db__describe_schema.`,
    `- Si la pregunta menciona "Hacienda" o un tipo de cambio o estado de una factura, podés usar mcp__hacienda-cr__*.`,
    `- NUNCA INSERT/UPDATE/DELETE. Solo lectura.`,
    `- Si la query devuelve 0 filas, decilo claramente. NO INVENTÉS números.`,
    `- Formato de números: colones ₡25.970,00 (con coma decimal, punto miles). Si los decimales son ,00 podés omitirlos.`,
    `- Fechas en lenguaje humano: "mayo del año pasado", "noviembre 2025", "el 14/05". Nunca formato ISO.`,
    ``,
    `Reglas de tono (CRÍTICAS — el campo "respuesta" se muestra tal cual al contador):`,
    `- PROHIBIDO Markdown en "respuesta". Nada de **negritas**, *cursivas*, \`backticks\`, listas con "-" ni numeradas con "1.". El frontend no lo renderiza, llega literal.`,
    `- PROHIBIDOS los encabezados tipo "Total: X · IVA: Y · Facturas: Z". Escribilo en prosa.`,
    `- PROHIBIDAS las frases de bot servicial: "¡Buenas noticias!", "¡Excelente!", "¡Claro que sí!", "Aquí tenés…", "Espero que te ayude".`,
    `- PROHIBIDOS los emojis y los verbos de relleno tipo IA (destacando, reflejando, abarcando, sirve como).`,
    `- PROHIBIDA la regla del tres forzada. No agrupes de a tres si no son tres.`,
    `- PROHIBIDO cerrar ofreciendo A o B o C. Una sola pregunta de seguimiento y solo si tiene sentido natural.`,
    `- Mantené las respuestas cortas (máx 4 oraciones) y mezclá frases cortas con largas. Variá el ritmo.`,
    `- Si la pregunta es ambigua, preguntá una sola cosa antes de queryar.`,
    `- Si la pregunta no es contable (clima, deportes), decí que solo cubrís contabilidad y ofrecé el resumen del mes.`,
    ``,
    `Antes de devolver tu "respuesta", releela en silencio:`,
    `1. ¿Tiene asteriscos, guiones de lista o backticks? Sacalos.`,
    `2. ¿Empieza con un saludo cordial tipo bot? Borralo y empezá con el dato.`,
    `3. ¿Suena a tutorial o catálogo? Reescribilo como si estuvieras conversando.`,
    ``,
    `Historial reciente:`,
    histTexto,
    ``,
    `Mensaje actual del contador:`,
    input.mensaje,
    ``,
    `Devolvé EXCLUSIVAMENTE el JSON con la forma { respuesta, sql_ejecutado, filas_devueltas }.`,
    `- respuesta: texto final para mostrar, español de CR, SIN Markdown.`,
    `- sql_ejecutado: la última query SELECT que ejecutaste (string), o null si no consultaste la base.`,
    `- filas_devueltas: cantidad de filas que devolvió la última query (entero), o null si no aplica.`,
  ].join('\n');
}

/**
 * Carga los últimos N turnos del user para contexto conversacional.
 */
export function loadHistorial(user_id: number | string, limit = 6): Array<{ rol: 'user' | 'assistant'; mensaje: string }> {
  const db = getDb();
  const rows = db
    .prepare(
      `SELECT rol, mensaje FROM chat_history WHERE user_id = ?
       ORDER BY timestamp DESC LIMIT ?`,
    )
    .all(String(user_id), limit) as Array<{ rol: 'user' | 'assistant'; mensaje: string }>;
  // Reverse: mostramos del más viejo al más nuevo.
  return rows.reverse();
}

export function _resetAgent(): void {
  _agent = null;
}
