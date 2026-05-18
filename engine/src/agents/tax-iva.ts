import { randomUUID } from 'node:crypto';
import { createSubagent, defaultSkillPath, type Subagent } from './claude.js';
import { validateFactura, getSchema } from '../lib/validator.js';
import { getDb } from '../lib/db.js';
import {
  AgenteFalloError,
  EmpresaDesconocidaError,
  FacturaInvalidaError,
  FacturaOtraEmpresaError,
} from '../lib/errors.js';
import { logger } from '../lib/logger.js';
import type {
  FacturaSchemaJson,
  LineaFactura,
  ResumenTaxIva,
  TarifaIVA,
} from '../types/factura.js';

let _agent: Subagent | null = null;
function getAgent(): Subagent {
  if (!_agent) {
    _agent = createSubagent({ name: 'tax-iva', skillPath: defaultSkillPath('tax-iva.md') });
  }
  return _agent;
}

const log = logger.child({ agente: 'tax-iva' });

export interface EnrichInput {
  factura: FacturaSchemaJson;
  empresa_id: string;
  /** Ruta donde quedó archivado el PDF/XML original (para persistir referencia). */
  storagePath?: string;
}

export interface EnrichOutput {
  factura: FacturaSchemaJson;
  resumen: ResumenTaxIva;
}

/**
 * Esquema de salida del agente Tax-IVA: factura enriquecida + resumen.
 * Schema "permisivo" — el modelo puede devolver propiedades extra sin romper.
 */
const TAX_IVA_OUTPUT_SCHEMA: Record<string, unknown> = {
  type: 'object',
  required: ['factura', 'resumen'],
  properties: {
    factura: getSchema(),
    resumen: {
      type: 'object',
      required: ['status', 'tarifas_detectadas', 'total_crc', 'mensaje_para_contador'],
      properties: {
        status: { type: 'string', enum: ['ok', 'revision_humana', 'error'] },
        factura_id: { type: ['string', 'null'] },
        tarifas_detectadas: { type: 'array', items: { type: 'number', enum: [0, 1, 2, 4, 13] } },
        total_crc: { type: 'number' },
        motivos_revision: { type: 'array', items: { type: 'string' } },
        mensaje_para_contador: { type: 'string' },
      },
    },
  },
};

/**
 * Enriquece una factura con tarifas inferidas + reconciliación + persistencia SQLite.
 *
 * En Fase 1:
 *  - Sin llamadas a BCCR (asumimos tipo_cambio = 1 si moneda = CRC; si es USD/EUR
 *    el agente debe marcar TIPO_CAMBIO_NO_DISPONIBLE).
 *  - Sin llamadas a Hacienda (no validamos padrón).
 *  - Sin escritura a Google Sheets.
 */
export async function enrichFactura(input: EnrichInput): Promise<EnrichOutput> {
  const agent = getAgent();
  const db = getDb();

  // Multi-tenancy: validar que empresa existe.
  const empresa = db
    .prepare('SELECT id, nombre FROM empresas WHERE id = ?')
    .get(input.empresa_id) as { id: string; nombre: string } | undefined;
  if (!empresa) {
    throw new EmpresaDesconocidaError(input.empresa_id);
  }

  // Multi-tenancy: validar receptor.
  const receptorCedula = input.factura.factura.receptor?.cedula;
  if (receptorCedula && receptorCedula.replace(/\D/g, '') !== input.empresa_id) {
    throw new FacturaOtraEmpresaError(receptorCedula, empresa.nombre);
  }

  // Llamada al agente Tax-IVA.
  const prompt = buildPrompt({ factura: input.factura, empresa });
  const { output, durationMs } = await agent.run<EnrichOutput>({
    prompt,
    outputSchema: TAX_IVA_OUTPUT_SCHEMA,
    maxTurns: 3,
  });
  log.info('Tax-IVA terminó', { empresa: empresa.id, durationMs });

  if (!output || typeof output !== 'object' || !('factura' in output) || !('resumen' in output)) {
    throw new AgenteFalloError('tax-iva', 'Output del agente no tiene { factura, resumen }');
  }

  // Algunos modelos devuelven la "factura" como el contenido interno (sin envelope).
  // Si falta `fuente` o `factura.factura`, re-empaquetamos heredando del input.
  const enriched = coerceFacturaEnvelope(output.factura, input.factura);

  const validation = validateFactura(enriched);
  if (!validation.valid) {
    log.warn('Tax-IVA devolvió factura inválida', {
      errorsText: validation.errorsText,
      payload: JSON.stringify(enriched).slice(0, 2000),
    });
    throw new FacturaInvalidaError(
      'Tax-IVA devolvió una factura que no cumple el schema',
      { errors: validation.errors, errorsText: validation.errorsText },
    );
  }

  // Reconciliación local de sanity-check (no falla — el agente ya marcó si hubo problema).
  const reconcile = reconcileFactura(enriched);
  if (!reconcile.ok) {
    log.warn('Reconciliación local falló', { detalle: reconcile });
  }

  // Asegurar resumen consistente.
  const resumen: ResumenTaxIva = {
    status: output.resumen.status ?? (enriched.requiere_revision_humana ? 'revision_humana' : 'ok'),
    factura_id: output.resumen.factura_id || enriched.factura.clave_numerica || randomUUID(),
    tarifas_detectadas: dedupeTarifas(output.resumen.tarifas_detectadas ?? collectTarifas(enriched)),
    total_crc: output.resumen.total_crc ?? enriched.factura.totales.total_factura,
    motivos_revision: output.resumen.motivos_revision ?? (enriched.motivo_revision ? [enriched.motivo_revision] : []),
    mensaje_para_contador: output.resumen.mensaje_para_contador ?? 'Factura procesada.',
  };

  // Persistir en SQLite (idempotente si hay clave_numerica).
  persistFactura({
    empresaId: input.empresa_id,
    facturaId: resumen.factura_id,
    factura: enriched,
    storagePath: input.storagePath,
  });

  return { factura: enriched, resumen };
}

/**
 * Si el modelo flattenó la respuesta (devolvió `factura: { ...inner }` en vez
 * de `factura: { fuente, confianza_extraccion, factura: { ...inner } }`),
 * re-empaquetamos heredando los campos faltantes desde el input original.
 */
function coerceFacturaEnvelope(maybe: unknown, original: FacturaSchemaJson): FacturaSchemaJson {
  if (typeof maybe !== 'object' || maybe === null) return original;
  const obj = maybe as Record<string, unknown>;
  // Si ya viene el envelope, lo devolvemos tal cual (rellenando si falta `fuente`).
  if ('factura' in obj && typeof obj.factura === 'object' && obj.factura !== null) {
    return {
      fuente: (obj.fuente as FacturaSchemaJson['fuente']) ?? original.fuente,
      confianza_extraccion:
        typeof obj.confianza_extraccion === 'number'
          ? (obj.confianza_extraccion as number)
          : original.confianza_extraccion,
      requiere_revision_humana:
        typeof obj.requiere_revision_humana === 'boolean'
          ? (obj.requiere_revision_humana as boolean)
          : original.requiere_revision_humana,
      motivo_revision:
        (obj.motivo_revision as FacturaSchemaJson['motivo_revision']) ?? original.motivo_revision ?? null,
      factura: obj.factura as FacturaSchemaJson['factura'],
    };
  }
  // El modelo aplanó: el objeto ES el factura interior. Re-envolvemos.
  return {
    fuente: (obj.fuente as FacturaSchemaJson['fuente']) ?? original.fuente,
    confianza_extraccion:
      typeof obj.confianza_extraccion === 'number'
        ? (obj.confianza_extraccion as number)
        : original.confianza_extraccion,
    requiere_revision_humana:
      typeof obj.requiere_revision_humana === 'boolean'
        ? (obj.requiere_revision_humana as boolean)
        : original.requiere_revision_humana,
    motivo_revision:
      (obj.motivo_revision as FacturaSchemaJson['motivo_revision']) ?? original.motivo_revision ?? null,
    factura: obj as unknown as FacturaSchemaJson['factura'],
  };
}

function buildPrompt(args: { factura: FacturaSchemaJson; empresa: { id: string; nombre: string } }): string {
  return [
    `Sos el agente Tax-IVA. Recibís una factura ya extraída por DocScan y debés:`,
    `1. Clasificar la tarifa de IVA por línea (\`tarifa_iva_inferida\`).`,
    `2. Calcular \`base_imponible\` e \`iva_calculado\` por línea.`,
    `3. Reconciliar contra el pie (totales.iva_por_tarifa, totales.iva_total, totales.total_factura).`,
    `4. Devolver { factura, resumen } donde \`factura\` es la misma factura enriquecida.`,
    ``,
    `Empresa cliente activa: ${args.empresa.nombre} (id=${args.empresa.id}).`,
    ``,
    `Reglas duras:`,
    `- Si la factura marca tarifa (\`tarifa_iva_marcada != null\`), copiala a \`tarifa_iva_inferida\`. No la sobreescribas.`,
    `- Si no marca, inferí aritméticamente con tolerancia ±0.5%. Si no encaja en {0,1,2,4,13}, marcá \`requiere_revision_humana: true\` y motivo \`TARIFA_NO_RECONOCIBLE\`.`,
    `- NO modifiqués el JSON de la factura más allá de los campos que estás llenando.`,
    `- En Fase 1 NO consultes BCCR ni Hacienda. Si moneda = "CRC", asumí tipo_cambio = 1.`,
    `- Devolvé \`status\`:`,
    `   - "ok" si todo cuadró`,
    `   - "revision_humana" si marcaste algún motivo en la factura`,
    `   - "error" solo si no podés procesar nada.`,
    `- En \`mensaje_para_contador\` escribí 1-2 oraciones en español de Costa Rica (ej: "Procesada FE de PriceSmart por ₡39.970 con 5 líneas al 13 % y 1 al 1 %.").`,
    ``,
    `Devolvé EXCLUSIVAMENTE el JSON con la forma { factura, resumen }.`,
    ``,
    `=== FACTURA (output de DocScan) ===`,
    JSON.stringify(args.factura, null, 2),
    `=== FIN ===`,
  ].join('\n');
}

function dedupeTarifas(arr: number[]): TarifaIVA[] {
  return [...new Set(arr)].filter((n): n is TarifaIVA => [0, 1, 2, 4, 13].includes(n));
}

function collectTarifas(f: FacturaSchemaJson): TarifaIVA[] {
  const set = new Set<TarifaIVA>();
  for (const l of f.factura.lineas) {
    const t = l.tarifa_iva_inferida ?? l.tarifa_iva_marcada;
    if (t !== null && t !== undefined) set.add(t as TarifaIVA);
  }
  return [...set];
}

interface ReconcileResult {
  ok: boolean;
  porTarifa: Record<string, { suma: number; pie: number; delta: number }>;
}

export function reconcileFactura(f: FacturaSchemaJson): ReconcileResult {
  const porTarifa: ReconcileResult['porTarifa'] = {};
  const lineas = f.factura.lineas;
  const piePorTarifa = f.factura.totales.iva_por_tarifa ?? {};

  for (const l of lineas) {
    const t = l.tarifa_iva_inferida ?? l.tarifa_iva_marcada;
    if (t === null || t === undefined) continue;
    const key = String(t);
    porTarifa[key] ??= { suma: 0, pie: 0, delta: 0 };
    porTarifa[key].suma += l.iva_calculado ?? 0;
  }

  for (const [k, v] of Object.entries(piePorTarifa)) {
    porTarifa[k] ??= { suma: 0, pie: 0, delta: 0 };
    porTarifa[k].pie = v;
  }

  let ok = true;
  for (const k of Object.keys(porTarifa)) {
    const e = porTarifa[k]!;
    e.delta = e.suma - e.pie;
    const totalIva = f.factura.totales.iva_total ?? 0;
    const tol = Math.max(1, Math.abs(totalIva) * 0.005);
    if (Math.abs(e.delta) > tol) ok = false;
  }

  return { ok, porTarifa };
}

interface PersistInput {
  empresaId: string;
  facturaId: string;
  factura: FacturaSchemaJson;
  storagePath?: string;
}

function persistFactura(input: PersistInput): void {
  const db = getDb();
  const f = input.factura.factura;
  const tipoCambio = f.tipo_cambio ?? (f.moneda === 'CRC' ? 1 : null);

  // En Fase 1 fallamos suave si no hay tipo_cambio para moneda extranjera:
  // grabamos pero los campos *_crc quedan iguales al valor original. El agente
  // ya debería haber marcado revisión humana.
  const tc = tipoCambio ?? 1;

  // upsert proveedor
  db.prepare(
    `INSERT INTO proveedores (cedula, tipo_cedula, nombre, actividad_economica, ultima_vez_visto)
     VALUES (?, ?, ?, ?, datetime('now'))
     ON CONFLICT(cedula) DO UPDATE SET
       nombre = excluded.nombre,
       tipo_cedula = COALESCE(excluded.tipo_cedula, proveedores.tipo_cedula),
       actividad_economica = COALESCE(excluded.actividad_economica, proveedores.actividad_economica),
       ultima_vez_visto = datetime('now')`,
  ).run(
    f.proveedor.cedula,
    f.proveedor.tipo_cedula ?? null,
    f.proveedor.nombre,
    f.proveedor.actividad_economica ?? null,
  );

  const tx = db.transaction(() => {
    db.prepare(
      `INSERT OR REPLACE INTO facturas (
        id, empresa_id, clave_numerica, consecutivo, tipo_documento, fecha_emision, hora_emision,
        proveedor_cedula, receptor_cedula, receptor_nombre, moneda, tipo_cambio,
        subtotal, total_gravado, total_exento, total_exonerado, descuento_total, iva_total, total_factura,
        subtotal_crc, iva_total_crc, total_crc,
        estado_hacienda, fuente, confianza_extraccion, requiere_revision_humana, motivo_revision, pdf_path
      ) VALUES (?, ?, ?, ?, ?, ?, ?,  ?, ?, ?, ?, ?,  ?, ?, ?, ?, ?, ?, ?,  ?, ?, ?,  ?, ?, ?, ?, ?, ?)`,
    ).run(
      input.facturaId,
      input.empresaId,
      f.clave_numerica ?? null,
      f.consecutivo ?? null,
      f.tipo_documento ?? null,
      f.fecha_emision,
      f.hora_emision ?? null,
      f.proveedor.cedula,
      f.receptor?.cedula ?? null,
      f.receptor?.nombre ?? null,
      f.moneda,
      tipoCambio,
      f.totales.subtotal,
      f.totales.total_gravado ?? 0,
      f.totales.total_exento ?? 0,
      f.totales.total_exonerado ?? 0,
      f.totales.descuento_total ?? 0,
      f.totales.iva_total,
      f.totales.total_factura,
      f.totales.subtotal * tc,
      f.totales.iva_total * tc,
      f.totales.total_factura * tc,
      'no_consultado',
      input.factura.fuente,
      input.factura.confianza_extraccion,
      input.factura.requiere_revision_humana ? 1 : 0,
      input.factura.motivo_revision ?? null,
      input.storagePath ?? null,
    );

    // Borrar líneas previas si era REPLACE
    db.prepare('DELETE FROM lineas_factura WHERE factura_id = ?').run(input.facturaId);

    const insLinea = db.prepare(
      `INSERT INTO lineas_factura (
        factura_id, numero_linea, codigo, descripcion, cantidad, unidad_medida,
        precio_unitario, precio_es_con_iva, descuento, monto_total,
        tarifa_iva, tarifa_fuente, base_imponible, iva_calculado,
        base_imponible_crc, iva_calculado_crc
      ) VALUES (?, ?, ?, ?, ?, ?,  ?, ?, ?, ?,  ?, ?, ?, ?,  ?, ?)`,
    );

    for (const l of f.lineas) {
      const tarifaFinal: TarifaIVA = (l.tarifa_iva_inferida ?? l.tarifa_iva_marcada ?? 13) as TarifaIVA;
      const tarifaFuente = l.tarifa_iva_marcada !== null && l.tarifa_iva_marcada !== undefined ? 'marcada' : 'inferida';
      const base = l.base_imponible ?? deriveBase(l, tarifaFinal);
      const iva = l.iva_calculado ?? l.monto_total - base;
      // precio_es_con_iva no lo sabemos sin re-correr la regla por dialecto;
      // dejamos 1 (CON IVA) si monto_total ≈ precio * cantidad, sino 0.
      const tolerance = Math.max(1, l.monto_total * 0.01);
      const sinIvaProyectado = l.precio_unitario * l.cantidad;
      const precioConIva = Math.abs(sinIvaProyectado - l.monto_total) <= tolerance ? 0 : 1;

      insLinea.run(
        input.facturaId,
        l.numero_linea,
        l.codigo ?? null,
        l.descripcion,
        l.cantidad,
        l.unidad_medida ?? null,
        l.precio_unitario,
        precioConIva,
        l.descuento ?? 0,
        l.monto_total,
        tarifaFinal,
        tarifaFuente,
        base,
        iva,
        base * tc,
        iva * tc,
      );
    }
  });

  tx();
}

function deriveBase(l: LineaFactura, tarifa: TarifaIVA): number {
  if (tarifa === 0) return l.monto_total;
  // Suponemos monto_total CON IVA (lo más común en dialectos CR observados).
  return l.monto_total / (1 + tarifa / 100);
}

export function _resetAgent(): void {
  _agent = null;
}
