import { Router } from 'express';
import { z } from 'zod';
import { obtenerTipoCambio, validarCedula, HaciendaError } from '../lib/hacienda.js';
import { AppError } from '../lib/errors.js';
import { requireAuth } from '../lib/auth.js';

export const haciendaRouter = Router();

const TcQuery = z.object({
  moneda: z.enum(['USD', 'EUR']).default('USD'),
  fecha: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
});

haciendaRouter.get('/hacienda/tc', requireAuth, async (req, res, next) => {
  try {
    const parsed = TcQuery.safeParse(req.query);
    if (!parsed.success) {
      throw new HaciendaError('Parámetros inválidos', parsed.error.flatten().fieldErrors);
    }
    const tc = await obtenerTipoCambio({ fecha: parsed.data.fecha, moneda: parsed.data.moneda });
    res.json(tc);
  } catch (err) {
    if (err instanceof HaciendaError) {
      res.status(503).json({ error: err.message, codigo: 'HACIENDA_ERROR', detalle: err.detalle });
      return;
    }
    if (err instanceof AppError) return next(err);
    next(err);
  }
});

haciendaRouter.get('/hacienda/cedula/:cedula', requireAuth, async (req, res, next) => {
  try {
    const cedula = String(req.params.cedula).replace(/\D/g, '');
    if (cedula.length < 9) {
      res.status(400).json({ error: 'Cédula inválida', codigo: 'CEDULA_INVALIDA' });
      return;
    }
    const ced = await validarCedula(cedula);
    res.json(ced);
  } catch (err) {
    if (err instanceof HaciendaError) {
      res.status(503).json({ error: err.message, codigo: 'HACIENDA_ERROR', detalle: err.detalle });
      return;
    }
    if (err instanceof AppError) return next(err);
    next(err);
  }
});
