import express, { type NextFunction, type Request, type Response } from 'express';
import cors from 'cors';
import { config } from './config.js';
import { logger } from './lib/logger.js';
import { initDb } from './lib/db-init.js';
import { healthRouter } from './routes/health.js';
import { processDocumentRouter } from './routes/process-document.js';
import { AppError } from './lib/errors.js';

const app = express();

// Body parsers (multer parsea multipart; JSON para futuros endpoints).
app.use(express.json({ limit: '5mb' }));

// CORS: dev del frontend Vite + el mismo motor.
app.use(
  cors({
    origin: ['http://localhost:5173', 'http://localhost:3000'],
    credentials: true,
  }),
);

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

app.use(healthRouter);
app.use(processDocumentRouter);

// 404
app.use((_req: Request, res: Response) => {
  res.status(404).json({
    error: 'Endpoint no encontrado',
    codigo: 'NOT_FOUND',
  });
});

// Error handler
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

function start(): void {
  try {
    initDb();
  } catch (err) {
    logger.error('No se pudo inicializar la DB; arrancando igual', {
      err: (err as Error).message,
    });
  }
  app.listen(config.port, () => {
    logger.info(`Motor FWD Contable AI escuchando en http://localhost:${config.port}`, {
      env: config.nodeEnv,
      authMode: config.claude.authMode,
    });
  });
}

start();

export { app };
