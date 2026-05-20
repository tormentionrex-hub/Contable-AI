/**
 * Capa de queries de la DB del proyecto. Compartida por:
 *   - el MCP in-process fwd-db (que la usa el Asistente Contable de Fase 3)
 *   - los endpoints HTTP /facturas, /facturas/:id, /adelantos, /caja-chica/saldo
 *
 * Reglas:
 *   - `runSelect` admite SOLO SELECT (regex de seguridad) → única vía para el agente.
 *   - `describeSchema` enumera tablas/vistas/columnas para que el agente sepa contra qué consulta.
 *   - Las funciones de escritura (insertarFactura, registrarProcesamiento) son métodos privilegiados
 *     que NO se exponen al agente como tool de escritura libre.
 */

import { getDb } from './db.js';
import type { FacturaSchemaJson, LineaFactura, TarifaIVA } from '../types/factura.js';

export class DbReadOnlyError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'DbReadOnlyError';
  }
}

const SELECT_ALLOWED = /^\s*(SELECT|WITH)\s/i;
const FORBIDDEN_KEYWORDS = /\b(INSERT|UPDATE|DELETE|DROP|ALTER|CREATE|REPLACE|ATTACH|DETACH|PRAGMA|VACUUM)\b/i;

export interface RunSelectResult {
  filas: unknown[];
  cantidad: number;
}

/**
 * Ejecuta una sentencia SELECT (o WITH ... SELECT). Cualquier otra cosa tira.
 */
export function runSelect(sql: string): RunSelectResult {
  const trimmed = sql.trim();
  if (!SELECT_ALLOWED.test(trimmed)) {
    throw new DbReadOnlyError('Solo se permiten consultas SELECT (o WITH ... SELECT).');
  }
  if (FORBIDDEN_KEYWORDS.test(trimmed)) {
    throw new DbReadOnlyError(
      'La consulta contiene palabras reservadas de escritura (INSERT/UPDATE/DELETE/DROP/...).',
    );
  }
  const db = getDb();
  // En SQLite multi-stmt no se ejecuta en una sola query con prepare(); usamos prepare/all.
  const rows = db.prepare(trimmed).all();
  return { filas: rows, cantidad: rows.length };
}

interface ColumnDescription {
  name: string;
  type: string;
  notnull: boolean;
  pk: boolean;
}

export interface SchemaDescription {
  tablas: Record<string, ColumnDescription[]>;
  vistas: Record<string, ColumnDescription[]>;
}

export function describeSchema(): SchemaDescription {
  const db = getDb();
  const objects = db
    .prepare("SELECT name, type FROM sqlite_master WHERE type IN ('table','view') AND name NOT LIKE 'sqlite_%'")
    .all() as Array<{ name: string; type: 'table' | 'view' }>;

  const tablas: Record<string, ColumnDescription[]> = {};
  const vistas: Record<string, ColumnDescription[]> = {};

  for (const o of objects) {
    const cols = db.prepare(`PRAGMA table_info(${o.name})`).all() as Array<{
      name: string;
      type: string;
      notnull: number;
      pk: number;
    }>;
    const descs: ColumnDescription[] = cols.map((c) => ({
      name: c.name,
      type: c.type,
      notnull: c.notnull === 1,
      pk: c.pk === 1,
    }));
    if (o.type === 'table') tablas[o.name] = descs;
    else vistas[o.name] = descs;
  }
  return { tablas, vistas };
}

// ============================================================
// Procesamientos (auditoría)
// ============================================================

export function registrarProcesamiento(args: {
  facturaId?: string | null;
  agente: 'docscan' | 'tax-iva' | 'asistente';
  evento: string;
  detalle?: unknown;
  duracionMs?: number;
}): void {
  const db = getDb();
  db.prepare(
    `INSERT INTO procesamientos (factura_id, agente, evento, detalle_json, duracion_ms)
     VALUES (?, ?, ?, ?, ?)`,
  ).run(
    args.facturaId ?? null,
    args.agente,
    args.evento,
    args.detalle ? JSON.stringify(args.detalle) : null,
    args.duracionMs ?? null,
  );
}

// ============================================================
// Facturas (lectura agregada)
// ============================================================

export interface FacturaResumen {
  id: string;
  empresa_id: string;
  fecha_emision: string;
  proveedor_cedula: string;
  proveedor_nombre: string | null;
  moneda: string;
  total_factura: number;
  total_crc: number;
  iva_total_crc: number;
  estado_hacienda: string | null;
  requiere_revision_humana: number;
  motivo_revision: string | null;
  estado_pago: 'pendiente' | 'pagada';
  fecha_pago: string | null;
  revisada_por_humano: number;
  fecha_revision: string | null;
  archivada: number;
  fecha_archivado: string | null;
}

export function listarFacturas(args: {
  empresa_id: string;
  mes?: string; // YYYY-MM
  desde?: string; // YYYY-MM-DD
  hasta?: string; // YYYY-MM-DD
  limit?: number;
  /** Si es true, devuelve únicamente facturas que requieren revisión y aún no fueron revisadas. */
  solo_pendientes_revision?: boolean;
  /** Si es true, incluye también las archivadas (para /historial). Por defecto se excluyen. */
  incluir_archivadas?: boolean;
}): FacturaResumen[] {
  const db = getDb();
  const where: string[] = ['f.empresa_id = ?'];
  const params: unknown[] = [args.empresa_id];

  if (args.mes) {
    where.push(`strftime('%Y-%m', f.fecha_emision) = ?`);
    params.push(args.mes);
  }
  if (args.desde) {
    where.push('f.fecha_emision >= ?');
    params.push(args.desde);
  }
  if (args.hasta) {
    where.push('f.fecha_emision <= ?');
    params.push(args.hasta);
  }
  // Filtro opcional: solo facturas que requieren revisión y NO han sido revisadas todavía.
  if (args.solo_pendientes_revision) {
    where.push('f.requiere_revision_humana = 1 AND COALESCE(f.revisada_por_humano, 0) = 0');
  }
  // Por defecto excluimos archivadas. Si se pide explícitamente incluirlas, no.
  if (!args.incluir_archivadas) {
    where.push('COALESCE(f.archivada, 0) = 0');
  }
  const limit = Math.min(args.limit ?? 200, 1000);

  return db
    .prepare(
      `SELECT
         f.id, f.empresa_id, f.fecha_emision, f.proveedor_cedula,
         p.nombre AS proveedor_nombre,
         f.moneda, f.total_factura, f.total_crc, f.iva_total_crc,
         f.estado_hacienda, f.requiere_revision_humana, f.motivo_revision,
         COALESCE(f.estado_pago, 'pendiente') AS estado_pago,
         f.fecha_pago,
         COALESCE(f.revisada_por_humano, 0) AS revisada_por_humano,
         f.fecha_revision,
         COALESCE(f.archivada, 0) AS archivada,
         f.fecha_archivado
       FROM facturas f
       LEFT JOIN proveedores p ON p.cedula = f.proveedor_cedula
       WHERE ${where.join(' AND ')}
       ORDER BY f.fecha_emision DESC, f.fecha_procesamiento DESC
       LIMIT ?`,
    )
    .all(...params, limit) as FacturaResumen[];
}

/**
 * Marca o desmarca una factura como pagada. Devuelve el nuevo estado o `null`
 * si la factura no existe / no pertenece a la empresa indicada.
 */
export function actualizarPagoFactura(args: {
  id: string;
  empresa_id: string;
  pagada: boolean;
  fecha_pago?: string | null;
  notas_pago?: string | null;
}): { estado_pago: 'pendiente' | 'pagada'; fecha_pago: string | null; notas_pago: string | null } | null {
  const db = getDb();
  const existe = db
    .prepare('SELECT id FROM facturas WHERE id = ? AND empresa_id = ?')
    .get(args.id, args.empresa_id) as { id: string } | undefined;
  if (!existe) return null;

  if (args.pagada) {
    const fecha = args.fecha_pago ?? new Date().toISOString().slice(0, 10);
    db.prepare(
      `UPDATE facturas
         SET estado_pago = 'pagada',
             fecha_pago = ?,
             notas_pago = ?
       WHERE id = ? AND empresa_id = ?`,
    ).run(fecha, args.notas_pago ?? null, args.id, args.empresa_id);
    return { estado_pago: 'pagada', fecha_pago: fecha, notas_pago: args.notas_pago ?? null };
  }

  db.prepare(
    `UPDATE facturas
       SET estado_pago = 'pendiente',
           fecha_pago = NULL,
           notas_pago = NULL
     WHERE id = ? AND empresa_id = ?`,
  ).run(args.id, args.empresa_id);
  return { estado_pago: 'pendiente', fecha_pago: null, notas_pago: null };
}

/**
 * Marca / desmarca una factura como "revisada por humano".
 * - revisada=true: queda como histórico (la bandera `requiere_revision_humana`
 *   se mantiene en 1 para auditoría, pero `revisada_por_humano` pasa a 1).
 * - revisada=false: re-abre la revisión (vuelve a aparecer en el filtro pendiente).
 */
export function actualizarRevisionFactura(args: {
  id: string;
  empresa_id: string;
  revisada: boolean;
  notas?: string | null;
  user_id?: number | null;
}): {
  revisada_por_humano: number;
  fecha_revision: string | null;
  notas_revision: string | null;
} | null {
  const db = getDb();
  const existe = db
    .prepare('SELECT id FROM facturas WHERE id = ? AND empresa_id = ?')
    .get(args.id, args.empresa_id) as { id: string } | undefined;
  if (!existe) return null;

  if (args.revisada) {
    const fecha = new Date().toISOString().slice(0, 10);
    db.prepare(
      `UPDATE facturas
         SET revisada_por_humano = 1,
             fecha_revision = ?,
             notas_revision = ?,
             revisada_por_user_id = ?
       WHERE id = ? AND empresa_id = ?`,
    ).run(fecha, args.notas ?? null, args.user_id ?? null, args.id, args.empresa_id);
    return { revisada_por_humano: 1, fecha_revision: fecha, notas_revision: args.notas ?? null };
  }

  db.prepare(
    `UPDATE facturas
       SET revisada_por_humano = 0,
           fecha_revision = NULL,
           notas_revision = NULL,
           revisada_por_user_id = NULL
     WHERE id = ? AND empresa_id = ?`,
  ).run(args.id, args.empresa_id);
  return { revisada_por_humano: 0, fecha_revision: null, notas_revision: null };
}

/**
 * Archiva (soft delete) un conjunto de facturas según los mismos filtros
 * que listarFacturas. Devuelve el conteo de filas afectadas.
 *
 * También archiva los adelantos de caja chica del mismo período cuando se
 * pasa `incluir_adelantos: true` (típicamente desde CajaChicaPage).
 */
export function archivarFacturas(args: {
  empresa_id: string;
  mes?: string;
  desde?: string;
  hasta?: string;
  ids?: string[];
  incluir_adelantos?: boolean;
  user_id?: number | null;
}): { facturas_archivadas: number; adelantos_archivados: number } {
  const db = getDb();
  const where: string[] = ['empresa_id = ?', 'COALESCE(archivada, 0) = 0'];
  const params: unknown[] = [args.empresa_id];

  if (args.ids && args.ids.length > 0) {
    const placeholders = args.ids.map(() => '?').join(',');
    where.push(`id IN (${placeholders})`);
    params.push(...args.ids);
  } else {
    if (args.mes) {
      where.push(`strftime('%Y-%m', fecha_emision) = ?`);
      params.push(args.mes);
    }
    if (args.desde) {
      where.push(`fecha_emision >= ?`);
      params.push(args.desde);
    }
    if (args.hasta) {
      where.push(`fecha_emision <= ?`);
      params.push(args.hasta);
    }
  }

  const now = new Date().toISOString();
  const result = db
    .prepare(
      `UPDATE facturas
         SET archivada = 1,
             fecha_archivado = ?,
             archivada_por_user_id = ?
       WHERE ${where.join(' AND ')}`,
    )
    .run(now, args.user_id ?? null, ...params);

  let adelantos_archivados = 0;
  if (args.incluir_adelantos) {
    const whAd: string[] = ['empresa_id = ?', 'COALESCE(archivada, 0) = 0'];
    const paAd: unknown[] = [args.empresa_id];
    if (args.mes) {
      whAd.push(`strftime('%Y-%m', fecha_entrega) = ?`);
      paAd.push(args.mes);
    }
    if (args.desde) {
      whAd.push(`fecha_entrega >= ?`);
      paAd.push(args.desde);
    }
    if (args.hasta) {
      whAd.push(`fecha_entrega <= ?`);
      paAd.push(args.hasta);
    }
    const resAd = db
      .prepare(
        `UPDATE adelantos_caja_chica
           SET archivada = 1,
               fecha_archivado = ?,
               archivada_por_user_id = ?
         WHERE ${whAd.join(' AND ')}`,
      )
      .run(now, args.user_id ?? null, ...paAd);
    adelantos_archivados = resAd.changes ?? 0;
  }

  return {
    facturas_archivadas: result.changes ?? 0,
    adelantos_archivados,
  };
}

/**
 * Restaura una factura archivada (la vuelve a hacer visible en las pantallas
 * normales). Se usa desde /historial.
 */
export function restaurarFactura(args: { id: string; empresa_id: string }): boolean {
  const db = getDb();
  const result = db
    .prepare(
      `UPDATE facturas
         SET archivada = 0,
             fecha_archivado = NULL,
             archivada_por_user_id = NULL
       WHERE id = ? AND empresa_id = ? AND archivada = 1`,
    )
    .run(args.id, args.empresa_id);
  return (result.changes ?? 0) > 0;
}

export interface FacturaDetallada {
  factura: Record<string, unknown>;
  lineas: Record<string, unknown>[];
}

export function obtenerFactura(id: string): FacturaDetallada | null {
  const db = getDb();
  const factura = db.prepare('SELECT * FROM facturas WHERE id = ?').get(id) as
    | Record<string, unknown>
    | undefined;
  if (!factura) return null;
  const lineas = db
    .prepare('SELECT * FROM lineas_factura WHERE factura_id = ? ORDER BY numero_linea')
    .all(id) as Record<string, unknown>[];
  return { factura, lineas };
}

// ============================================================
// Caja chica — adelantos + saldo
// ============================================================

export interface Adelanto {
  id?: number;
  empresa_id: string;
  monto_crc: number;
  fecha_entrega: string;
  responsable?: string | null;
  estado?: 'abierto' | 'cerrado';
  notas?: string | null;
}

export function crearAdelanto(a: Adelanto): number {
  const db = getDb();
  const info = db
    .prepare(
      `INSERT INTO adelantos_caja_chica (empresa_id, monto_crc, fecha_entrega, responsable, estado, notas)
       VALUES (?, ?, ?, ?, ?, ?)`,
    )
    .run(
      a.empresa_id,
      a.monto_crc,
      a.fecha_entrega,
      a.responsable ?? null,
      a.estado ?? 'abierto',
      a.notas ?? null,
    );
  return Number(info.lastInsertRowid);
}

export interface SaldoCajaChica {
  empresa_id: string;
  desde: string;
  hasta: string;
  adelantos_abiertos_crc: number;
  facturas_periodo_crc: number;
  cantidad_adelantos: number;
  cantidad_facturas: number;
  saldo: number; // adelantos_abiertos - facturas_periodo
}

export function calcularSaldoCajaChica(args: {
  empresa_id: string;
  desde?: string;
  hasta?: string;
}): SaldoCajaChica {
  const db = getDb();
  const desde = args.desde ?? '0000-01-01';
  const hasta = args.hasta ?? '9999-12-31';

  const adelantos = db
    .prepare(
      `SELECT COALESCE(SUM(monto_crc),0) AS suma, COUNT(*) AS cant
       FROM adelantos_caja_chica
       WHERE empresa_id = ? AND estado = 'abierto'
         AND COALESCE(archivada, 0) = 0
         AND fecha_entrega BETWEEN ? AND ?`,
    )
    .get(args.empresa_id, desde, hasta) as { suma: number; cant: number };

  const facturas = db
    .prepare(
      `SELECT COALESCE(SUM(total_crc),0) AS suma, COUNT(*) AS cant
       FROM facturas
       WHERE empresa_id = ? AND fecha_emision BETWEEN ? AND ?
         AND COALESCE(archivada, 0) = 0`,
    )
    .get(args.empresa_id, desde, hasta) as { suma: number; cant: number };

  return {
    empresa_id: args.empresa_id,
    desde,
    hasta,
    adelantos_abiertos_crc: adelantos.suma,
    facturas_periodo_crc: facturas.suma,
    cantidad_adelantos: adelantos.cant,
    cantidad_facturas: facturas.cant,
    saldo: adelantos.suma - facturas.suma,
  };
}

// ============================================================
// Inserción de factura (idempotente por clave_numerica o id)
// ============================================================
// Esta función ya existe en agents/tax-iva.ts (persistFactura). Acá la dejamos
// como API estable para que el MCP del Asistente pueda insertar facturas
// que vengan por otros canales (ej: n8n via webhook). Por ahora la firma queda
// declarada pero NO se llama desde el agente — solo `runSelect` + readers.
export interface InsertarFacturaArgs {
  empresa_id: string;
  factura: FacturaSchemaJson;
  storagePath?: string;
}

export function insertarFactura(args: InsertarFacturaArgs): string {
  // Delegamos a la implementación canónica del agente Tax-IVA para no duplicar lógica.
  // Import dinámico para evitar dependencia circular en boot.
  // eslint-disable-next-line @typescript-eslint/no-require-imports, @typescript-eslint/no-var-requires
  throw new Error(
    'insertarFactura: usar enrichFactura del agente Tax-IVA. Esta función es un placeholder para el MCP del Asistente (Fase 3).',
  );
}
