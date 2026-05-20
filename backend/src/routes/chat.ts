import { Router } from 'express';
import { z } from 'zod';
import { preguntar, loadHistorial } from '../agents/asistente.js';
import { requireAuth, resolveEmpresaId } from '../lib/auth.js';
import { AppError } from '../lib/errors.js';
import { logger } from '../lib/logger.js';
import { getDb } from '../lib/db.js';

const log = logger.child({ mod: 'chat-routes' });

export const chatRouter = Router();

const ChatBody = z.object({
  mensaje: z.string().min(1).max(2000),
  empresa_id: z.string().optional(), // opcional: ignorado si el user es contador (toma su empresa del token)
  incluir_historial: z.boolean().optional().default(true),
});

/**
 * POST /chat
 * Body: { mensaje, empresa_id?, incluir_historial? }
 * Header (cuando auth está habilitada): Authorization: Bearer <token>
 *
 * Si auth está deshabilitada (dev mode), `empresa_id` es obligatorio en el body.
 */
chatRouter.post('/chat', requireAuth, async (req, res, next) => {
  try {
    const parsed = ChatBody.safeParse(req.body);
    if (!parsed.success) {
      throw new AppError('BODY_INVALIDO', 'Body inválido', 400, parsed.error.flatten().fieldErrors);
    }
    const empresa_id = resolveEmpresaId(req) ?? parsed.data.empresa_id ?? null;
    if (!empresa_id) {
      throw new AppError(
        'EMPRESA_REQUERIDA',
        'Falta `empresa_id` en el body (o el usuario no tiene empresa asignada en el token).',
        400,
      );
    }
    // Verificar que la empresa exista.
    const emp = getDb().prepare('SELECT id FROM empresas WHERE id = ?').get(empresa_id) as
      | { id: string }
      | undefined;
    if (!emp) throw new AppError('EMPRESA_DESCONOCIDA', `La empresa ${empresa_id} no existe.`, 404);

    const user_id = req.user?.id ?? 'anon';
    const historial = parsed.data.incluir_historial ? loadHistorial(user_id, 6) : [];

    log.info('Pregunta recibida', {
      user_id,
      empresa_id,
      msg_preview: parsed.data.mensaje.slice(0, 80),
    });

    const out = await preguntar({
      mensaje: parsed.data.mensaje,
      empresa_id,
      user_id,
      historial,
    });

    res.json({
      respuesta: out.respuesta,
      sql_ejecutado: out.sql_ejecutado,
      filas_devueltas: out.filas_devueltas,
      duracion_ms: out.duracion_ms,
    });
  } catch (err) {
    if (err instanceof AppError) return next(err);
    next(err);
  }
});

/**
 * GET /chat/historial?limit=N
 * Devuelve los últimos N turnos del usuario actual.
 */
chatRouter.get('/chat/historial', requireAuth, (req, res, next) => {
  try {
    const limit = Math.min(Number(req.query.limit ?? 20), 100);
    const user_id = req.user?.id ?? 'anon';
    const turnos = loadHistorial(user_id, limit);
    res.json({ user_id, total: turnos.length, turnos });
  } catch (err) {
    next(err);
  }
});
