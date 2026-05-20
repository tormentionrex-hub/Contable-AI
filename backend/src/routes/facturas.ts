import { Router } from 'express';
import { z } from 'zod';
import {
  listarFacturas,
  obtenerFactura,
  actualizarPagoFactura,
  actualizarRevisionFactura,
  archivarFacturas,
  restaurarFactura,
} from '../lib/fwd-db.js';
import { requireAuth, resolveEmpresaId } from '../lib/auth.js';
import { config } from '../config.js';

export const facturasRouter = Router();

const ListQuery = z.object({
  empresa_id: z.string().min(1),
  mes: z.string().regex(/^\d{4}-\d{2}$/).optional(),
  desde: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  hasta: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  limit: z.coerce.number().int().positive().max(1000).optional(),
  pendientes_revision: z.union([z.literal('1'), z.literal('true')]).optional(),
  incluir_archivadas: z.union([z.literal('1'), z.literal('true')]).optional(),
});

facturasRouter.get('/facturas', requireAuth, (req, res) => {
  const parsed = ListQuery.safeParse(req.query);
  if (!parsed.success) {
    res.status(400).json({ error: 'Query inválida', codigo: 'QUERY_INVALIDA', detalle: parsed.error.flatten().fieldErrors });
    return;
  }
  // Forzar filtrado por empresa_id del token para contadores.
  const empresaResuelta = resolveEmpresaId(req) ?? parsed.data.empresa_id;
  if (!empresaResuelta) {
    res.status(400).json({ error: 'Falta empresa_id', codigo: 'EMPRESA_REQUERIDA' });
    return;
  }
  const filas = listarFacturas({
    ...parsed.data,
    empresa_id: empresaResuelta,
    solo_pendientes_revision: parsed.data.pendientes_revision === '1' || parsed.data.pendientes_revision === 'true',
    incluir_archivadas: parsed.data.incluir_archivadas === '1' || parsed.data.incluir_archivadas === 'true',
  });
  res.json({ total: filas.length, facturas: filas });
});

facturasRouter.get('/facturas/:id', requireAuth, (req, res) => {
  const det = obtenerFactura(String(req.params.id));
  if (!det) {
    res.status(404).json({ error: 'Factura no encontrada', codigo: 'NO_ENCONTRADA' });
    return;
  }
  // Si el user es contador, verificar que la factura pertenece a su empresa.
  if (config.auth.enabled && req.user && req.user.rol === 'contador') {
    const empresaFactura = (det.factura as { empresa_id?: string }).empresa_id;
    if (empresaFactura !== req.user.empresa_id) {
      res.status(403).json({ error: 'Factura de otra empresa', codigo: 'PERMISO_DENEGADO' });
      return;
    }
  }
  res.json(det);
});

// ============================================================
// Marcar / desmarcar pago de una factura
// ============================================================
const PagoBody = z.object({
  pagada: z.boolean(),
  fecha_pago: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  notas_pago: z.string().max(500).optional(),
});

facturasRouter.put('/facturas/:id/pago', requireAuth, (req, res) => {
  const parsed = PagoBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({
      error: 'Body inválido',
      codigo: 'BODY_INVALIDO',
      detalle: parsed.error.flatten().fieldErrors,
    });
    return;
  }

  const id = String(req.params.id);

  // Resolver empresa: para contadores, viene del JWT; para admin sin JWT, lo
  // sacamos del registro de la factura.
  let empresa_id: string | null = resolveEmpresaId(req) ?? null;
  if (!empresa_id) {
    const det = obtenerFactura(id);
    if (!det) {
      res.status(404).json({ error: 'Factura no encontrada', codigo: 'NO_ENCONTRADA' });
      return;
    }
    empresa_id = (det.factura as { empresa_id?: string }).empresa_id ?? null;
  }
  if (!empresa_id) {
    res.status(400).json({ error: 'Empresa no determinable', codigo: 'EMPRESA_REQUERIDA' });
    return;
  }

  const nuevo = actualizarPagoFactura({
    id,
    empresa_id,
    pagada: parsed.data.pagada,
    fecha_pago: parsed.data.fecha_pago ?? null,
    notas_pago: parsed.data.notas_pago ?? null,
  });
  if (!nuevo) {
    res.status(404).json({
      error: 'Factura no encontrada o no pertenece a tu empresa',
      codigo: 'NO_ENCONTRADA',
    });
    return;
  }

  res.json({ id, ...nuevo });
});

// ============================================================
// Archivar (soft delete) facturas + opcionalmente sus adelantos
// ============================================================
const ArchivarBody = z.object({
  mes: z.string().regex(/^\d{4}-\d{2}$/).optional(),
  desde: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  hasta: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  ids: z.array(z.string()).max(500).optional(),
  incluir_adelantos: z.boolean().optional(),
  // Safeguard: archivar TODAS las facturas (sin ningún filtro) requiere flag
  // explícito. Esto evita que un body vacío accidental ({}) borre todo el
  // historial activo de la empresa.
  confirmar_todas: z.boolean().optional(),
}).refine(
  (d) => d.mes || d.desde || d.hasta || (d.ids && d.ids.length > 0) || d.confirmar_todas === true,
  {
    message:
      'Hay que pasar al menos un filtro (mes, desde/hasta, ids) o confirmar_todas:true para archivar todo.',
    path: ['confirmar_todas'],
  },
);

facturasRouter.post('/facturas/archivar', requireAuth, (req, res) => {
  const parsed = ArchivarBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({
      error: 'Body inválido',
      codigo: 'BODY_INVALIDO',
      detalle: parsed.error.flatten().fieldErrors,
    });
    return;
  }
  const empresa_id = resolveEmpresaId(req);
  if (!empresa_id) {
    res.status(400).json({ error: 'Falta empresa_id', codigo: 'EMPRESA_REQUERIDA' });
    return;
  }

  const r = archivarFacturas({
    empresa_id,
    mes: parsed.data.mes,
    desde: parsed.data.desde,
    hasta: parsed.data.hasta,
    ids: parsed.data.ids,
    incluir_adelantos: parsed.data.incluir_adelantos === true,
    user_id: req.user?.id ?? null,
  });
  res.json(r);
});

facturasRouter.post('/facturas/:id/restaurar', requireAuth, (req, res) => {
  const id = String(req.params.id);
  let empresa_id: string | null = resolveEmpresaId(req) ?? null;
  if (!empresa_id) {
    const det = obtenerFactura(id);
    if (!det) {
      res.status(404).json({ error: 'Factura no encontrada', codigo: 'NO_ENCONTRADA' });
      return;
    }
    empresa_id = (det.factura as { empresa_id?: string }).empresa_id ?? null;
  }
  if (!empresa_id) {
    res.status(400).json({ error: 'Empresa no determinable', codigo: 'EMPRESA_REQUERIDA' });
    return;
  }
  const ok = restaurarFactura({ id, empresa_id });
  if (!ok) {
    res.status(404).json({
      error: 'Factura no archivada o inexistente',
      codigo: 'NO_ENCONTRADA',
    });
    return;
  }
  res.json({ ok: true, id });
});

// ============================================================
// Historial completo (incluye archivadas)
// ============================================================
facturasRouter.get('/historial', requireAuth, (req, res) => {
  const parsed = ListQuery.safeParse(req.query);
  if (!parsed.success) {
    res.status(400).json({ error: 'Query inválida', codigo: 'QUERY_INVALIDA', detalle: parsed.error.flatten().fieldErrors });
    return;
  }
  const empresaResuelta = resolveEmpresaId(req) ?? parsed.data.empresa_id;
  if (!empresaResuelta) {
    res.status(400).json({ error: 'Falta empresa_id', codigo: 'EMPRESA_REQUERIDA' });
    return;
  }
  const filas = listarFacturas({
    ...parsed.data,
    empresa_id: empresaResuelta,
    incluir_archivadas: true,
    limit: parsed.data.limit ?? 1000,
  });
  const activas = filas.filter((f) => !f.archivada).length;
  const archivadas = filas.filter((f) => f.archivada).length;
  res.json({ total: filas.length, activas, archivadas, facturas: filas });
});

// ============================================================
// Marcar / desmarcar revisión humana
// ============================================================
const RevisionBody = z.object({
  revisada: z.boolean(),
  notas: z.string().max(500).optional(),
});

facturasRouter.put('/facturas/:id/revision', requireAuth, (req, res) => {
  const parsed = RevisionBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({
      error: 'Body inválido',
      codigo: 'BODY_INVALIDO',
      detalle: parsed.error.flatten().fieldErrors,
    });
    return;
  }

  const id = String(req.params.id);

  let empresa_id: string | null = resolveEmpresaId(req) ?? null;
  if (!empresa_id) {
    const det = obtenerFactura(id);
    if (!det) {
      res.status(404).json({ error: 'Factura no encontrada', codigo: 'NO_ENCONTRADA' });
      return;
    }
    empresa_id = (det.factura as { empresa_id?: string }).empresa_id ?? null;
  }
  if (!empresa_id) {
    res.status(400).json({ error: 'Empresa no determinable', codigo: 'EMPRESA_REQUERIDA' });
    return;
  }

  const nuevo = actualizarRevisionFactura({
    id,
    empresa_id,
    revisada: parsed.data.revisada,
    notas: parsed.data.notas ?? null,
    user_id: req.user?.id ?? null,
  });
  if (!nuevo) {
    res.status(404).json({
      error: 'Factura no encontrada o no pertenece a tu empresa',
      codigo: 'NO_ENCONTRADA',
    });
    return;
  }

  res.json({ id, ...nuevo });
});
