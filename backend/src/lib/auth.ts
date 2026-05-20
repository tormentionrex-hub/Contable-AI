/**
 * Autenticación: hash de password con bcrypt + tokens JWT firmados.
 *
 * Modo opt-in: si `config.auth.enabled` es false (no hay JWT_SECRET en .env),
 * `requireAuth` deja pasar todo y loguea WARN. Apenas se setea JWT_SECRET el
 * sistema empieza a validar Bearer tokens.
 */

import bcrypt from 'bcrypt';
import jwt from 'jsonwebtoken';
import type { Request, Response, NextFunction } from 'express';
import { config } from '../config.js';
import { getDb } from './db.js';
import { logger } from './logger.js';
import { AppError } from './errors.js';

const log = logger.child({ mod: 'auth' });

// ============================================================
// Errores
// ============================================================

export class AuthError extends AppError {
  constructor(message: string, httpStatus = 401, detalle?: unknown) {
    super('AUTH_ERROR', message, httpStatus, detalle);
  }
}

export class CredencialesInvalidasError extends AppError {
  constructor() {
    super('CREDENCIALES_INVALIDAS', 'Email o contraseña incorrectos.', 401);
  }
}

export class TokenInvalidoError extends AppError {
  constructor(message = 'Token inválido o expirado.') {
    super('TOKEN_INVALIDO', message, 401);
  }
}

export class PermisoDenegadoError extends AppError {
  constructor(message = 'No tenés permiso para esta acción.') {
    super('PERMISO_DENEGADO', message, 403);
  }
}

// ============================================================
// Tipos
// ============================================================

export type Rol = 'admin' | 'contador';

export interface UserRow {
  id: number;
  email: string;
  password_hash: string;
  nombre: string;
  rol: Rol;
  empresa_id: string | null;
  activo: number;
  ultimo_login: string | null;
  creado: string;
}

export interface UserPublic {
  id: number;
  email: string;
  nombre: string;
  rol: Rol;
  empresa_id: string | null;
}

export interface JwtPayload {
  sub: number;
  email: string;
  rol: Rol;
  empresa_id: string | null;
}

// Express request augmentation — disponible en handlers que pasaron por requireAuth.
declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      user?: UserPublic;
    }
  }
}

// ============================================================
// Password
// ============================================================

const BCRYPT_ROUNDS = 10;

export async function hashPassword(plain: string): Promise<string> {
  return bcrypt.hash(plain, BCRYPT_ROUNDS);
}

export async function verifyPassword(plain: string, hash: string): Promise<boolean> {
  return bcrypt.compare(plain, hash);
}

// ============================================================
// JWT
// ============================================================

export function signToken(user: UserPublic): string {
  if (!config.auth.jwtSecret) {
    throw new AuthError('JWT_SECRET no configurado. Setealo en .env para emitir tokens.');
  }
  const payload: JwtPayload = {
    sub: user.id,
    email: user.email,
    rol: user.rol,
    empresa_id: user.empresa_id,
  };
  // @ts-expect-error — el tipo de expiresIn admite string ("8h") pero los .d.ts son estrictos
  return jwt.sign(payload, config.auth.jwtSecret, { expiresIn: config.auth.jwtExpiresIn });
}

export function verifyToken(token: string): JwtPayload {
  if (!config.auth.jwtSecret) {
    throw new AuthError('JWT_SECRET no configurado.');
  }
  try {
    const decoded = jwt.verify(token, config.auth.jwtSecret) as unknown as JwtPayload;
    return decoded;
  } catch (err) {
    throw new TokenInvalidoError((err as Error).message);
  }
}

// ============================================================
// Repo de users
// ============================================================

function toPublic(row: UserRow): UserPublic {
  return { id: row.id, email: row.email, nombre: row.nombre, rol: row.rol, empresa_id: row.empresa_id };
}

export function findUserByEmail(email: string): UserRow | null {
  const db = getDb();
  return (db
    .prepare('SELECT * FROM users WHERE email = ? AND activo = 1')
    .get(email.toLowerCase()) as UserRow | undefined) ?? null;
}

export function findUserById(id: number): UserRow | null {
  const db = getDb();
  return (db
    .prepare('SELECT * FROM users WHERE id = ? AND activo = 1')
    .get(id) as UserRow | undefined) ?? null;
}

export interface CreateUserInput {
  email: string;
  password: string;
  nombre: string;
  rol: Rol;
  empresa_id?: string | null;
}

export async function createUser(input: CreateUserInput): Promise<UserPublic> {
  const db = getDb();
  const hash = await hashPassword(input.password);
  const empresa_id = input.empresa_id ?? (input.rol === 'admin' ? null : null);
  const info = db
    .prepare(
      `INSERT INTO users (email, password_hash, nombre, rol, empresa_id)
       VALUES (?, ?, ?, ?, ?)`,
    )
    .run(input.email.toLowerCase(), hash, input.nombre, input.rol, empresa_id);
  const id = Number(info.lastInsertRowid);
  return { id, email: input.email.toLowerCase(), nombre: input.nombre, rol: input.rol, empresa_id };
}

export async function loginUser(email: string, password: string): Promise<{ user: UserPublic; token: string }> {
  const row = findUserByEmail(email);
  if (!row) throw new CredencialesInvalidasError();
  const ok = await verifyPassword(password, row.password_hash);
  if (!ok) throw new CredencialesInvalidasError();

  const db = getDb();
  db.prepare(`UPDATE users SET ultimo_login = datetime('now') WHERE id = ?`).run(row.id);

  const user = toPublic(row);
  const token = signToken(user);
  return { user, token };
}

// ============================================================
// Middleware
// ============================================================

/**
 * Middleware que verifica el Bearer token y popula req.user.
 *
 * Comportamiento opt-in:
 *   - Si config.auth.enabled === false (no hay JWT_SECRET): deja pasar TODO,
 *     loguea WARN una vez por boot. Útil en dev local con n8n.
 *   - Si config.auth.enabled === true: exige Authorization: Bearer <token>.
 */
let _devModeWarned = false;
export function requireAuth(req: Request, _res: Response, next: NextFunction): void {
  if (!config.auth.enabled) {
    if (!_devModeWarned) {
      log.warn(
        'AUTH DESHABILITADA: JWT_SECRET vacío en .env. Las rutas privadas son PÚBLICAS. ' +
          'Setea JWT_SECRET para activar la verificación de tokens.',
      );
      _devModeWarned = true;
    }
    return next();
  }
  const header = req.header('authorization');
  if (!header || !header.toLowerCase().startsWith('bearer ')) {
    return next(new TokenInvalidoError('Falta header Authorization: Bearer <token>.'));
  }
  const token = header.slice(7).trim();
  try {
    const payload = verifyToken(token);
    const row = findUserById(payload.sub);
    if (!row) return next(new TokenInvalidoError('El usuario del token ya no existe o está deshabilitado.'));
    req.user = toPublic(row);
    next();
  } catch (err) {
    next(err);
  }
}

/** Exige rol admin. Aplicalo DESPUÉS de requireAuth. */
export function requireAdmin(req: Request, _res: Response, next: NextFunction): void {
  if (!config.auth.enabled) return next();
  if (!req.user) return next(new TokenInvalidoError('requireAuth debe ejecutarse antes de requireAdmin.'));
  if (req.user.rol !== 'admin') return next(new PermisoDenegadoError('Solo admin puede acceder a este recurso.'));
  next();
}

/**
 * Devuelve el empresa_id efectivo del request:
 *  - Si auth está deshabilitada o el user es admin: usa req.body.empresa_id / req.query.empresa_id.
 *  - Si el user es contador: SIEMPRE su empresa_id del token (ignora el del body).
 *
 * Si no se puede determinar, devuelve null y el route debe responder 400.
 */
export function resolveEmpresaId(req: Request): string | null {
  if (config.auth.enabled && req.user && req.user.rol === 'contador') {
    return req.user.empresa_id;
  }
  // Admin o auth deshabilitada: tomar del request.
  const fromBody = (req.body && typeof req.body === 'object' && req.body !== null && (req.body as Record<string, unknown>).empresa_id) ?? null;
  const fromQuery = req.query?.empresa_id ?? null;
  const raw = fromBody ?? fromQuery;
  return typeof raw === 'string' && raw.length > 0 ? raw : null;
}
