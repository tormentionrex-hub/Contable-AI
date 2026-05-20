import { Router } from 'express';
import { z } from 'zod';
import { loginUser, requireAuth, AuthError } from '../lib/auth.js';
import { logger } from '../lib/logger.js';
import { AppError } from '../lib/errors.js';
import { config } from '../config.js';

const log = logger.child({ mod: 'auth-routes' });

export const authRouter = Router();

const LoginBody = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});

/**
 * POST /auth/login
 * Body: { email, password }
 * Response: { user: { id, email, nombre, rol, empresa_id }, token, expira_en }
 */
authRouter.post('/auth/login', async (req, res, next) => {
  try {
    if (!config.auth.enabled) {
      throw new AuthError(
        'Autenticación deshabilitada en el servidor (falta JWT_SECRET en .env).',
        503,
      );
    }
    const parsed = LoginBody.safeParse(req.body);
    if (!parsed.success) {
      throw new AuthError('Email o password inválidos.', 400, parsed.error.flatten().fieldErrors);
    }
    const { user, token } = await loginUser(parsed.data.email, parsed.data.password);
    log.info('Login exitoso', { user_id: user.id, email: user.email, rol: user.rol });
    res.json({
      user,
      token,
      expira_en: config.auth.jwtExpiresIn,
    });
  } catch (err) {
    if (err instanceof AppError) return next(err);
    next(err);
  }
});

/**
 * GET /auth/me
 * Devuelve el usuario asociado al token actual. Incluye también el nombre de
 * la empresa asociada para que el frontend pueda mostrar "FUNDACION CRC Endurance"
 * en vez de "3006696489" en los subtítulos de cada página.
 */
authRouter.get('/auth/me', requireAuth, async (req, res) => {
  const { getDb } = await import('../lib/db.js');

  // Empresa por defecto si no hay user (modo dev) o si el user es admin sin empresa.
  const empresaId = req.user?.empresa_id ?? '3006696489';
  const empresa = getDb()
    .prepare('SELECT id, nombre FROM empresas WHERE id = ?')
    .get(empresaId) as { id: string; nombre: string } | undefined;
  const empresaPayload = empresa ?? { id: empresaId, nombre: empresaId };

  if (!req.user) {
    res.json({ user: null, auth_enabled: false, empresa: empresaPayload });
    return;
  }

  res.json({ user: req.user, auth_enabled: true, empresa: empresaPayload });
});
