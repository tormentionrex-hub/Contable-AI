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
}

export function listarFacturas(args: {
  empresa_id: string;
  mes?: string; // YYYY-MM
  desde?: string; // YYYY-MM-DD
  hasta?: string; // YYYY-MM-DD
  limit?: number;
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
  const limit = Math.min(args.limit ?? 200, 1000);

  return db
    .prepare(
      `SELECT
         f.id, f.empresa_id, f.fecha_emision, f.proveedor_cedula,
         p.nombre AS proveedor_nombre,
         f.moneda, f.total_factura, f.total_crc, f.iva_total_crc,
         f.estado_hacienda, f.requiere_revision_humana, f.motivo_revision
       FROM facturas f
       LEFT JOIN proveedores p ON p.cedula = f.proveedor_cedula
       WHERE ${where.join(' AND ')}
       ORDER BY f.fecha_emision DESC, f.fecha_procesamiento DESC
       LIMIT ?`,
    )
    .all(...params, limit) as FacturaResumen[];
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
         AND fecha_entrega BETWEEN ? AND ?`,
    )
    .get(args.empresa_id, desde, hasta) as { suma: number; cant: number };

  const facturas = db
    .prepare(
      `SELECT COALESCE(SUM(total_crc),0) AS suma, COUNT(*) AS cant
       FROM facturas
       WHERE empresa_id = ? AND fecha_emision BETWEEN ? AND ?`,
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
