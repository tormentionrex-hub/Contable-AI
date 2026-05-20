/**
 * Endpoints administrativos. Solo accesibles para rol 'admin'.
 *
 *   GET  /admin/stats           — métricas globales del sistema
 *   GET  /admin/users           — lista de usuarios
 *   POST /admin/users           — crear contador/admin
 *   PATCH /admin/users/:id      — activar/desactivar usuario
 *   GET  /admin/empresas        — lista de empresas + facturas/mes
 *   POST /admin/empresas        — alta de empresa cliente
 */

import { Router } from 'express';
import { z } from 'zod';
import { getDb } from '../lib/db.js';
import {
  createUser,
  requireAuth,
  requireAdmin,
  type UserPublic,
} from '../lib/auth.js';
import { AppError } from '../lib/errors.js';

export const adminRouter = Router();

// ============================================================
// Stats globales
// ============================================================

adminRouter.get('/admin/stats', requireAuth, requireAdmin, (_req, res) => {
  const db = getDb();
  const totalEmpresas = (db.prepare('SELECT COUNT(*) AS n FROM empresas').get() as { n: number }).n;
  const totalFacturas = (db.prepare('SELECT COUNT(*) AS n FROM facturas').get() as { n: number }).n;
  const totalUsuarios = (db
    .prepare('SELECT COUNT(*) AS n FROM users WHERE activo = 1')
    .get() as { n: number }).n;
  const facturasRevision = (db
    .prepare('SELECT COUNT(*) AS n FROM facturas WHERE requiere_revision_humana = 1')
    .get() as { n: number }).n;
  const mesActual = new Date().toISOString().slice(0, 7);
  const facturasMes = (db
    .prepare(`SELECT COUNT(*) AS n FROM facturas WHERE strftime('%Y-%m', fecha_emision) = ?`)
    .get(mesActual) as { n: number }).n;
  const totalCrcMes = (db
    .prepare(
      `SELECT COALESCE(SUM(total_crc),0) AS s FROM facturas WHERE strftime('%Y-%m', fecha_emision) = ?`,
    )
    .get(mesActual) as { s: number }).s;
  const procMes = (db
    .prepare(
      `SELECT COUNT(*) AS n FROM procesamientos WHERE strftime('%Y-%m', timestamp) = ?`,
    )
    .get(mesActual) as { n: number }).n;

  res.json({
    total_empresas: totalEmpresas,
    total_facturas: totalFacturas,
    total_usuarios: totalUsuarios,
    facturas_revision_humana: facturasRevision,
    mes_actual: mesActual,
    facturas_mes: facturasMes,
    total_crc_mes: totalCrcMes,
    procesamientos_mes: procMes,
  });
});

// ============================================================
// Usuarios
// ============================================================

adminRouter.get('/admin/users', requireAuth, requireAdmin, (_req, res) => {
  const db = getDb();
  const rows = db
    .prepare(
      `SELECT u.id, u.email, u.nombre, u.rol, u.empresa_id, u.activo, u.ultimo_login, u.creado,
              e.nombre AS empresa_nombre
         FROM users u
         LEFT JOIN empresas e ON e.id = u.empresa_id
         ORDER BY u.rol, u.nombre`,
    )
    .all() as Array<UserPublic & { activo: number; ultimo_login: string | null; creado: string; empresa_nombre: string | null }>;
  res.json({ total: rows.length, users: rows });
});

const CreateUserBody = z.object({
  email: z.string().email(),
  password: z.string().min(8),
  nombre: z.string().min(2),
  rol: z.enum(['admin', 'contador']),
  empresa_id: z.string().optional().nullable(),
});

adminRouter.post('/admin/users', requireAuth, requireAdmin, async (req, res, next) => {
  try {
    const parsed = CreateUserBody.safeParse(req.body);
    if (!parsed.success) {
      throw new AppError('BODY_INVALIDO', 'Body inválido', 400, parsed.error.flatten().fieldErrors);
    }
    if (parsed.data.rol === 'contador' && !parsed.data.empresa_id) {
      throw new AppError('BODY_INVALIDO', 'Un contador necesita empresa_id', 400);
    }
    const user = await createUser({
      email: parsed.data.email,
      password: parsed.data.password,
      nombre: parsed.data.nombre,
      rol: parsed.data.rol,
      empresa_id: parsed.data.empresa_id ?? null,
    });
    res.status(201).json(user);
  } catch (err) {
    if (err instanceof AppError) return next(err);
    // Conflicto de email duplicado.
    if ((err as Error).message?.includes('UNIQUE')) {
      return next(new AppError('EMAIL_DUPLICADO', 'Ya existe un usuario con ese email.', 409));
    }
    next(err);
  }
});

const PatchUserBody = z.object({
  activo: z.boolean().optional(),
  empresa_id: z.string().nullable().optional(),
  nombre: z.string().min(2).optional(),
});

adminRouter.patch('/admin/users/:id', requireAuth, requireAdmin, (req, res, next) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isFinite(id)) {
      throw new AppError('BODY_INVALIDO', 'ID inválido', 400);
    }
    const parsed = PatchUserBody.safeParse(req.body);
    if (!parsed.success) {
      throw new AppError('BODY_INVALIDO', 'Body inválido', 400, parsed.error.flatten().fieldErrors);
    }
    const db = getDb();
    const sets: string[] = [];
    const params: unknown[] = [];
    if (parsed.data.activo !== undefined) {
      sets.push('activo = ?');
      params.push(parsed.data.activo ? 1 : 0);
    }
    if (parsed.data.empresa_id !== undefined) {
      sets.push('empresa_id = ?');
      params.push(parsed.data.empresa_id);
    }
    if (parsed.data.nombre !== undefined) {
      sets.push('nombre = ?');
      params.push(parsed.data.nombre);
    }
    if (sets.length === 0) {
      throw new AppError('BODY_INVALIDO', 'Nada para actualizar', 400);
    }
    params.push(id);
    db.prepare(`UPDATE users SET ${sets.join(', ')} WHERE id = ?`).run(...params);
    res.json({ ok: true });
  } catch (err) {
    if (err instanceof AppError) return next(err);
    next(err);
  }
});

// ============================================================
// Empresas
// ============================================================

adminRouter.get('/admin/empresas', requireAuth, requireAdmin, (_req, res) => {
  const db = getDb();
  const empresas = db
    .prepare(
      `SELECT e.id, e.nombre, e.tipo_cedula, e.moneda_principal, e.estado, e.sheet_id, e.creada,
              (SELECT COUNT(*) FROM facturas f WHERE f.empresa_id = e.id) AS total_facturas,
              (SELECT COUNT(*) FROM facturas f WHERE f.empresa_id = e.id
                AND strftime('%Y-%m', f.fecha_emision) = strftime('%Y-%m','now')) AS facturas_mes,
              (SELECT COALESCE(SUM(total_crc),0) FROM facturas f WHERE f.empresa_id = e.id
                AND strftime('%Y-%m', f.fecha_emision) = strftime('%Y-%m','now')) AS total_crc_mes
         FROM empresas e
         ORDER BY e.nombre`,
    )
    .all();
  res.json({ total: empresas.length, empresas });
});

const CreateEmpresaBody = z.object({
  id: z.string().regex(/^\d{9,12}$/, 'Cédula jurídica: 9-12 dígitos sin guiones'),
  nombre: z.string().min(2),
  tipo_cedula: z.enum(['fisica', 'juridica', 'dimex', 'nite']).default('juridica'),
  actividad_economica: z.string().optional(),
  moneda_principal: z.enum(['CRC', 'USD', 'EUR']).optional().default('CRC'),
});

adminRouter.post('/admin/empresas', requireAuth, requireAdmin, (req, res, next) => {
  try {
    const parsed = CreateEmpresaBody.safeParse(req.body);
    if (!parsed.success) {
      throw new AppError('BODY_INVALIDO', 'Body inválido', 400, parsed.error.flatten().fieldErrors);
    }
    const db = getDb();
    try {
      db.prepare(
        `INSERT INTO empresas (id, nombre, tipo_cedula, actividad_economica, moneda_principal)
         VALUES (?, ?, ?, ?, ?)`,
      ).run(
        parsed.data.id,
        parsed.data.nombre,
        parsed.data.tipo_cedula,
        parsed.data.actividad_economica ?? null,
        parsed.data.moneda_principal ?? 'CRC',
      );
    } catch (e) {
      if ((e as Error).message?.includes('UNIQUE')) {
        throw new AppError('EMPRESA_DUPLICADA', 'Ya existe una empresa con esa cédula.', 409);
      }
      throw e;
    }
    res.status(201).json({
      ok: true,
      empresa_id: parsed.data.id,
      nombre: parsed.data.nombre,
    });
  } catch (err) {
    if (err instanceof AppError) return next(err);
    next(err);
  }
});

// ============================================================
// Procesamientos recientes (auditoría)
// ============================================================

adminRouter.get('/admin/procesamientos', requireAuth, requireAdmin, (req, res) => {
  const limit = Math.min(Number(req.query.limit ?? 50), 500);
  const db = getDb();
  const rows = db
    .prepare(
      `SELECT p.id, p.factura_id, p.agente, p.evento, p.duracion_ms, p.timestamp,
              f.proveedor_cedula, f.total_crc, f.empresa_id
         FROM procesamientos p
         LEFT JOIN facturas f ON f.id = p.factura_id
         ORDER BY p.id DESC LIMIT ?`,
    )
    .all(limit);
  res.json({ total: rows.length, procesamientos: rows });
});
