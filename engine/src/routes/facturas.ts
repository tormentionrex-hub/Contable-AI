import { Router } from 'express';
import { z } from 'zod';
import { listarFacturas, obtenerFactura } from '../lib/fwd-db.js';

export const facturasRouter = Router();

const ListQuery = z.object({
  empresa_id: z.string().min(1),
  mes: z.string().regex(/^\d{4}-\d{2}$/).optional(),
  desde: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  hasta: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  limit: z.coerce.number().int().positive().max(1000).optional(),
});

facturasRouter.get('/facturas', (req, res) => {
  const parsed = ListQuery.safeParse(req.query);
  if (!parsed.success) {
    res.status(400).json({ error: 'Query inválida', codigo: 'QUERY_INVALIDA', detalle: parsed.error.flatten().fieldErrors });
    return;
  }
  const filas = listarFacturas(parsed.data);
  res.json({ total: filas.length, facturas: filas });
});

facturasRouter.get('/facturas/:id', (req, res) => {
  const det = obtenerFactura(String(req.params.id));
  if (!det) {
    res.status(404).json({ error: 'Factura no encontrada', codigo: 'NO_ENCONTRADA' });
    return;
  }
  res.json(det);
});
