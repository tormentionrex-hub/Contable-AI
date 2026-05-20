import { Router } from 'express';
import { z } from 'zod';
import { crearAdelanto, calcularSaldoCajaChica } from '../lib/fwd-db.js';
import { getDb } from '../lib/db.js';
import { requireAuth, resolveEmpresaId } from '../lib/auth.js';

export const adelantosRouter = Router();

const CrearAdelantoBody = z.object({
  empresa_id: z.string().min(1),
  monto_crc: z.number().positive(),
  fecha_entrega: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  responsable: z.string().optional(),
  notas: z.string().optional(),
});

adelantosRouter.post('/adelantos', requireAuth, (req, res) => {
  const parsed = CrearAdelantoBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'Body inválido', codigo: 'BODY_INVALIDO', detalle: parsed.error.flatten().fieldErrors });
    return;
  }
  // Contadores solo crean adelantos para su empresa.
  const empresaResuelta = resolveEmpresaId(req) ?? parsed.data.empresa_id;

  const empresa = getDb()
    .prepare('SELECT id FROM empresas WHERE id = ?')
    .get(empresaResuelta) as { id: string } | undefined;
  if (!empresa) {
    res.status(404).json({ error: 'Empresa no existe', codigo: 'EMPRESA_DESCONOCIDA' });
    return;
  }

  const payload = { ...parsed.data, empresa_id: empresaResuelta };
  const id = crearAdelanto(payload);
  res.status(201).json({ id, ...payload, estado: 'abierto' });
});

const SaldoQuery = z.object({
  empresa_id: z.string().min(1),
  desde: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  hasta: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
});

adelantosRouter.get('/caja-chica/saldo', requireAuth, (req, res) => {
  const parsed = SaldoQuery.safeParse(req.query);
  if (!parsed.success) {
    res.status(400).json({ error: 'Query inválida', codigo: 'QUERY_INVALIDA', detalle: parsed.error.flatten().fieldErrors });
    return;
  }
  const empresaResuelta = resolveEmpresaId(req) ?? parsed.data.empresa_id;
  if (!empresaResuelta) {
    res.status(400).json({ error: 'Falta empresa_id', codigo: 'EMPRESA_REQUERIDA' });
    return;
  }
  const saldo = calcularSaldoCajaChica({ ...parsed.data, empresa_id: empresaResuelta });
  res.json(saldo);
});
