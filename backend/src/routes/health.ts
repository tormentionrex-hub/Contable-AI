import { Router } from 'express';
import { dbHealth, getDb } from '../lib/db.js';
import { config } from '../config.js';

export const healthRouter = Router();

/**
 * Health check más estricto que solo "SELECT 1":
 *  - Verifica que la DB responde
 *  - Verifica que las tablas críticas existen (facturas, empresas, users)
 *  - Verifica que las columnas agregadas en migraciones están presentes
 * Devuelve 503 si algo no está OK, para que load balancers / cron / Uptime
 * Robot puedan detectarlo.
 */
healthRouter.get('/health', (_req, res) => {
  const db = dbHealth();
  if (db !== 'connected') {
    res.status(503).json({ status: 'degraded', version: config.version, db });
    return;
  }

  try {
    const dbInstance = getDb();
    const tablas = dbInstance
      .prepare(
        `SELECT name FROM sqlite_master WHERE type='table' AND name IN ('facturas','empresas','users','adelantos_caja_chica','lineas_factura')`,
      )
      .all() as Array<{ name: string }>;
    const requeridas = ['facturas', 'empresas', 'users', 'adelantos_caja_chica', 'lineas_factura'];
    const faltantes = requeridas.filter((t) => !tablas.some((row) => row.name === t));
    if (faltantes.length > 0) {
      res.status(503).json({
        status: 'degraded',
        version: config.version,
        db,
        problema: 'tablas_faltantes',
        faltantes,
      });
      return;
    }
    // Verificar que las columnas más recientes (archivado) existen
    const cols = dbInstance.prepare(`PRAGMA table_info(facturas)`).all() as Array<{ name: string }>;
    const colsCriticas = ['archivada', 'estado_pago', 'revisada_por_humano'];
    const colsFaltantes = colsCriticas.filter((c) => !cols.some((row) => row.name === c));
    if (colsFaltantes.length > 0) {
      res.status(503).json({
        status: 'degraded',
        version: config.version,
        db,
        problema: 'migraciones_pendientes',
        columnas_faltantes: colsFaltantes,
      });
      return;
    }
    res.json({
      status: 'ok',
      version: config.version,
      db,
      schema: 'completo',
    });
  } catch (err) {
    res.status(503).json({
      status: 'degraded',
      version: config.version,
      db,
      problema: 'check_falló',
      err: (err as Error).message,
    });
  }
});
