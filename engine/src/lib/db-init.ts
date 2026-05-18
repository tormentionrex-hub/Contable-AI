import fs from 'node:fs';
import path from 'node:path';
import { config } from '../config.js';
import { getDb, closeDb } from './db.js';
import { logger } from './logger.js';

/**
 * Inicializa la base de datos SQLite ejecutando engine/schemas/db.sql.
 * Idempotente: usa CREATE TABLE IF NOT EXISTS / INSERT OR IGNORE.
 */
export function initDb(): void {
  const schemaPath = path.join(config.paths.schemas, 'db.sql');
  if (!fs.existsSync(schemaPath)) {
    throw new Error(`No se encontró el schema en ${schemaPath}`);
  }

  const sql = fs.readFileSync(schemaPath, 'utf8');
  const db = getDb();

  // exec() acepta múltiples statements separados por ;
  db.exec(sql);

  // Verificar empresa piloto
  const empresa = db
    .prepare('SELECT id, nombre FROM empresas WHERE id = ?')
    .get('3006696489') as { id: string; nombre: string } | undefined;

  if (empresa) {
    logger.info('DB inicializada', {
      path: config.paths.db,
      empresa_piloto: `${empresa.nombre} (${empresa.id})`,
    });
  } else {
    logger.warn('DB inicializada pero la empresa piloto no se insertó');
  }
}

// Permitir invocación directa: `tsx src/lib/db-init.ts` (vía script npm db:init)
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
