import express, { type NextFunction, type Request, type Response } from 'express';
import cors from 'cors';
import path from 'node:path';
import fs from 'node:fs';
import { config } from './config.js';
import { logger } from './lib/logger.js';
import { initDb } from './lib/db-init.js';
import { healthRouter } from './routes/health.js';
import { processDocumentRouter } from './routes/process-document.js';
import { haciendaRouter } from './routes/hacienda.js';
import { facturasRouter } from './routes/facturas.js';
import { adelantosRouter } from './routes/adelantos.js';
import { authRouter } from './routes/auth.js';
import { chatRouter } from './routes/chat.js';
import { excelRouter } from './routes/excel.js';
import { adminRouter } from './routes/admin.js';
import { AppError } from './lib/errors.js';
import { seedAdminIfMissing } from './lib/db-init.js';

const app = express();

// ============================================================
// CORS — configurable por env
// ============================================================
// En dev: localhost:5173 (Vite) + localhost:3000 (mismo motor).
// En prod: el dominio público del frontend (Easypanel / GitHub Pages) + cualquier
//   otro que el usuario meta en CORS_ORIGINS (coma-separado).
// Si CORS_ORIGINS contiene "*", permite todos (solo para debug — NO usar en prod real).
const defaultOrigins = ['http://localhost:5173', 'http://localhost:3000'];
const extraOrigins = (process.env.CORS_ORIGINS ?? '')
  .split(',')
  .map((s) => s.trim())
  .filter((s) => s.length > 0);
const allowAll = extraOrigins.includes('*');
const allowedOrigins = allowAll ? '*' : [...new Set([...defaultOrigins, ...extraOrigins])];

app.use(
  cors({
    origin: allowAll ? true : (allowedOrigins as string[]),
    credentials: !allowAll,
  }),
);

// Body parsers (multer parsea multipart; JSON para futuros endpoints).
app.use(express.json({ limit: '5mb' }));

// Logger por request.
app.use((req: Request, res: Response, next: NextFunction) => {
  const start = Date.now();
  res.on('finish', () => {
    logger.info('http', {
      method: req.method,
      path: req.path,
      status: res.statusCode,
      ms: Date.now() - start,
    });
  });
  next();
});

// ============================================================
// Frontend estático (solo en producción, ANTES de los routers privados)
// ============================================================
// En NODE_ENV=production, servimos el build de Vite (`frontend/dist`) desde el
// mismo Express. express.static SOLO responde si el archivo existe en disco;
// las requests a /facturas, /chat, /health, etc. caen por debajo a los routers.
const API_PREFIXES = [
  '/health',
  '/auth',
  '/chat',
  '/process-document',
  '/hacienda',
  '/facturas',
  '/adelantos',
  '/caja-chica',
  '/excel',
  '/admin',
  '/historial',
];

let frontendDist: string | null = null;
if (config.isProd) {
  const candidate = path.resolve(config.paths.projectRoot, '..', 'frontend', 'dist');
  if (fs.existsSync(path.join(candidate, 'index.html'))) {
    frontendDist = candidate;
    logger.info('Sirviendo frontend estático', { path: frontendDist });
    app.use(express.static(frontendDist, { index: false }));
  } else {
    logger.warn('NODE_ENV=production pero no se encontró frontend/dist/index.html. Sirviendo solo API.', {
      esperado: path.join(candidate, 'index.html'),
    });
  }
}

// ============================================================
// Rutas de la API
// ============================================================
// Rutas públicas (sin auth): /health, /auth/login.
app.use(healthRouter);
app.use(authRouter);

// Rutas privadas: cada endpoint declara su requireAuth por separado (no router.use)
// para que el middleware NO se aplique a paths que no son de la API.
app.use(chatRouter);
app.use(processDocumentRouter);
app.use(haciendaRouter);
app.use(facturasRouter);
app.use(adelantosRouter);
app.use(excelRouter);
app.use(adminRouter);

// ============================================================
// SPA fallback (solo prod, después de todos los routers)
// ============================================================
// Para rutas client-side (/login, /upload, /chat, /facturas/123 etc.) que NO matcheen
// archivos estáticos ni endpoints de API, devolvemos index.html para que React Router
// haga su trabajo. Importante: solo aplica a GET — POST/PUT a path no registrado da 404.
if (config.isProd && frontendDist) {
  app.use((req: Request, res: Response, next: NextFunction) => {
    if (req.method !== 'GET') return next();
    if (API_PREFIXES.some((p) => req.path === p || req.path.startsWith(p + '/'))) return next();
    res.sendFile(path.join(frontendDist!, 'index.html'));
  });
}

// ============================================================
// 404 + error handler
// ============================================================
app.use((req: Request, res: Response) => {
  res.status(404).json({
    error: 'Endpoint no encontrado',
    codigo: 'NOT_FOUND',
    path: req.path,
  });
});

app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
  if (err instanceof AppError) {
    res.status(err.httpStatus).json({
      error: err.message,
      codigo: err.codigo,
      detalle: err.detalle ?? undefined,
    });
    return;
  }
  logger.error('Error no controlado', {
    err: err instanceof Error ? err.message : String(err),
    stack: err instanceof Error ? err.stack : undefined,
  });
  res.status(500).json({
    error: 'Ocurrió un error interno. Por favor reintentá.',
    codigo: 'INTERNAL_ERROR',
  });
});

async function start(): Promise<void> {
  // initDb es OBLIGATORIO. Si falla, el server NO arranca: queremos detectar
  // el problema en el boot, no dejar que /health responda "ok" mientras todo
  // lo demás revienta con "no such table".
  try {
    initDb();
    await seedAdminIfMissing();
  } catch (err) {
    logger.error('initDb falló — abortando arranque', {
      err: (err as Error).message,
      stack: (err as Error).stack,
    });
    throw err;
  }

  await new Promise<void>((resolve, reject) => {
    const server = app.listen(config.port, () => {
      logger.info(`Motor FWD Contable AI escuchando en http://localhost:${config.port}`, {
        env: config.nodeEnv,
        authEnabled: config.auth.enabled,
        corsOrigins: allowAll ? '*' : extraOrigins.length > 0 ? extraOrigins : 'defaults',
        sirveFrontend: config.isProd,
      });
      resolve();
    });
    server.on('error', (err) => {
      logger.error('app.listen falló', { err: err.message });
      reject(err);
    });
  });
}

// Red de seguridad global: una promesa olvidada o una excepción no atrapada
// en Node 24 tira el proceso. Logueamos y damos un grace period para que el
// orquestador (Easypanel / pm2) lo reinicie limpiamente.
process.on('unhandledRejection', (reason) => {
  logger.error('unhandledRejection capturada', {
    reason: reason instanceof Error ? reason.message : String(reason),
    stack: reason instanceof Error ? reason.stack : undefined,
  });
});

process.on('uncaughtException', (err) => {
  logger.error('uncaughtException capturada — reiniciar proceso', {
    err: err.message,
    stack: err.stack,
  });
  // Dejamos 1 segundo para que el logger flushee y salimos. El orquestador
  // (Easypanel, pm2, systemd) se encarga de reiniciar.
  setTimeout(() => process.exit(1), 1000);
});

void start().catch((err) => {
  logger.error('Boot falló — el proceso termina', {
    err: err instanceof Error ? err.message : String(err),
  });
  process.exit(1);
});

export { app };
