import fs from 'node:fs';
import path from 'node:path';
import { config } from '../config.js';
import { getDb, closeDb } from './db.js';
import { logger } from './logger.js';

/**
 * Inicializa la base de datos SQLite ejecutando engine/schemas/db.sql.
 * Idempotente: usa CREATE TABLE IF NOT EXISTS / INSERT OR IGNORE.
 * Aplica migraciones manuales para columnas nuevas en tablas pre-existentes.
 */
export function initDb(): void {
  const schemaPath = path.join(config.paths.schemas, 'db.sql');
  if (!fs.existsSync(schemaPath)) {
    throw new Error(`No se encontró el schema en ${schemaPath}`);
  }

  const sql = fs.readFileSync(schemaPath, 'utf8');
  const db = getDb();

  db.exec(sql);

  // Migración manual: si la tabla `empresas` existía desde Fase 1 sin `sheet_id`,
  // SQLite no agrega la columna con CREATE TABLE IF NOT EXISTS. La añadimos aquí.
  const empresasCols = db.prepare(`PRAGMA table_info(empresas)`).all() as Array<{ name: string }>;
  if (!empresasCols.some((c) => c.name === 'sheet_id')) {
    db.exec(`ALTER TABLE empresas ADD COLUMN sheet_id TEXT;`);
    logger.info('Migración aplicada: empresas.sheet_id agregado');
  }

  const empresa = db
    .prepare('SELECT id, nombre, sheet_id FROM empresas WHERE id = ?')
    .get('3006696489') as { id: string; nombre: string; sheet_id: string | null } | undefined;

  if (empresa) {
    logger.info('DB inicializada', {
      path: config.paths.db,
      empresa_piloto: `${empresa.nombre} (${empresa.id})`,
      sheet_id: empresa.sheet_id ?? '(sin crear)',
    });
  } else {
    logger.warn('DB inicializada pero la empresa piloto no se insertó');
  }
}

const isDirectRun =
  process.argv[1] && (process.argv[1].endsWith('db-init.ts') || process.argv[1].endsWith('db-init.js'));

if (isDirectRun) {
  try {
    initDb();
    closeDb();
    process.exit(0);
  } catch (err) {
    logger.error('Error inicializando DB', { err: (err as Error).message });
    process.exit(1);
  }
}
