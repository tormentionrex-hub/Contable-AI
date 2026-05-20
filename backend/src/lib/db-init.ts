import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
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

  // Las migraciones ALTER TABLE se aplican dentro de una transacción para
  // que si crashea a mitad de camino (poder, OOM, kill -9), la DB no quede
  // con estado mixto: o todas las columnas nuevas están, o ninguna.
  db.transaction(() => {
  // Migración manual: si la tabla `empresas` existía desde Fase 1 sin `sheet_id`,
  // SQLite no agrega la columna con CREATE TABLE IF NOT EXISTS. La añadimos aquí.
  const empresasCols = db.prepare(`PRAGMA table_info(empresas)`).all() as Array<{ name: string }>;
  if (!empresasCols.some((c) => c.name === 'sheet_id')) {
    db.exec(`ALTER TABLE empresas ADD COLUMN sheet_id TEXT;`);
    logger.info('Migración aplicada: empresas.sheet_id agregado');
  }

  // Migración: estado de pago en facturas. Agregamos las 3 columnas si no existen
  // y las facturas previas quedan como 'pendiente'.
  const facturasCols = db.prepare(`PRAGMA table_info(facturas)`).all() as Array<{ name: string }>;
  const tieneCol = (name: string): boolean => facturasCols.some((c) => c.name === name);

  if (!tieneCol('estado_pago')) {
    db.exec(`ALTER TABLE facturas ADD COLUMN estado_pago TEXT NOT NULL DEFAULT 'pendiente';`);
    logger.info('Migración aplicada: facturas.estado_pago agregado');
  }
  if (!tieneCol('fecha_pago')) {
    db.exec(`ALTER TABLE facturas ADD COLUMN fecha_pago TEXT;`);
    logger.info('Migración aplicada: facturas.fecha_pago agregado');
  }
  if (!tieneCol('notas_pago')) {
    db.exec(`ALTER TABLE facturas ADD COLUMN notas_pago TEXT;`);
    logger.info('Migración aplicada: facturas.notas_pago agregado');
  }
  if (!tieneCol('revisada_por_humano')) {
    db.exec(`ALTER TABLE facturas ADD COLUMN revisada_por_humano INTEGER NOT NULL DEFAULT 0;`);
    logger.info('Migración aplicada: facturas.revisada_por_humano agregado');
  }
  if (!tieneCol('fecha_revision')) {
    db.exec(`ALTER TABLE facturas ADD COLUMN fecha_revision TEXT;`);
    logger.info('Migración aplicada: facturas.fecha_revision agregado');
  }
  if (!tieneCol('notas_revision')) {
    db.exec(`ALTER TABLE facturas ADD COLUMN notas_revision TEXT;`);
    logger.info('Migración aplicada: facturas.notas_revision agregado');
  }
  if (!tieneCol('revisada_por_user_id')) {
    db.exec(`ALTER TABLE facturas ADD COLUMN revisada_por_user_id INTEGER;`);
    logger.info('Migración aplicada: facturas.revisada_por_user_id agregado');
  }
  if (!tieneCol('archivada')) {
    db.exec(`ALTER TABLE facturas ADD COLUMN archivada INTEGER NOT NULL DEFAULT 0;`);
    logger.info('Migración aplicada: facturas.archivada agregado');
  }
  if (!tieneCol('fecha_archivado')) {
    db.exec(`ALTER TABLE facturas ADD COLUMN fecha_archivado TEXT;`);
    logger.info('Migración aplicada: facturas.fecha_archivado agregado');
  }
  if (!tieneCol('archivada_por_user_id')) {
    db.exec(`ALTER TABLE facturas ADD COLUMN archivada_por_user_id INTEGER;`);
    logger.info('Migración aplicada: facturas.archivada_por_user_id agregado');
  }

  // Migración: archivado de adelantos.
  const adelantosCols = db.prepare(`PRAGMA table_info(adelantos_caja_chica)`).all() as Array<{ name: string }>;
  const tieneColAd = (name: string): boolean => adelantosCols.some((c) => c.name === name);
  if (!tieneColAd('archivada')) {
    db.exec(`ALTER TABLE adelantos_caja_chica ADD COLUMN archivada INTEGER NOT NULL DEFAULT 0;`);
    logger.info('Migración aplicada: adelantos_caja_chica.archivada agregado');
  }
  if (!tieneColAd('fecha_archivado')) {
    db.exec(`ALTER TABLE adelantos_caja_chica ADD COLUMN fecha_archivado TEXT;`);
    logger.info('Migración aplicada: adelantos_caja_chica.fecha_archivado agregado');
  }
  if (!tieneColAd('archivada_por_user_id')) {
    db.exec(`ALTER TABLE adelantos_caja_chica ADD COLUMN archivada_por_user_id INTEGER;`);
    logger.info('Migración aplicada: adelantos_caja_chica.archivada_por_user_id agregado');
  }

  // Índices.
  db.exec(`CREATE INDEX IF NOT EXISTS idx_facturas_pago ON facturas(empresa_id, estado_pago);`);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_facturas_pendientes_revision
           ON facturas(empresa_id) WHERE requiere_revision_humana = 1 AND revisada_por_humano = 0;`);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_facturas_archivada ON facturas(empresa_id, archivada);`);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_adelantos_archivada ON adelantos_caja_chica(empresa_id, archivada);`);
  })();

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

/**
 * Si la tabla `users` está vacía, crea un admin inicial.
 *  - Email: variable ADMIN_EMAIL del .env (fallback admin@local).
 *  - Password: variable ADMIN_PASSWORD del .env, o una aleatoria de 12 chars
 *    impresa por stdout para que el usuario la copie y la guarde.
 * Idempotente: si ya hay al menos 1 user, no hace nada.
 */
export async function seedAdminIfMissing(): Promise<void> {
  const db = getDb();
  const row = db.prepare('SELECT COUNT(*) as n FROM users').get() as { n: number };
  if (row.n > 0) return;

  // Import dinámico para evitar dependencia circular auth.ts -> db.ts.
  const { hashPassword } = await import('./auth.js');

  const email = (config.auth.adminEmail ?? 'admin@local').toLowerCase();
  const passwordPlano = config.auth.adminPassword ?? crypto.randomBytes(9).toString('base64url');
  const passwordGenerada = !config.auth.adminPassword;

  const hash = await hashPassword(passwordPlano);
  db.prepare(
    `INSERT INTO users (email, password_hash, nombre, rol, empresa_id)
     VALUES (?, ?, ?, 'admin', NULL)`,
  ).run(email, hash, 'Administrador Forward CR');

  logger.info('Admin inicial creado', {
    email,
    password_generada: passwordGenerada,
  });

  if (passwordGenerada) {
    // eslint-disable-next-line no-console
    console.log(
      `\n=== ADMIN INICIAL CREADO ===\n` +
        `  Email:    ${email}\n` +
        `  Password: ${passwordPlano}\n` +
        `\nGuardá esa contraseña; el seed no la persiste en texto plano. Podés cambiarla\n` +
        `en .env (ADMIN_EMAIL + ADMIN_PASSWORD) y borrar la fila users antes del próximo arranque.\n`,
    );
  }
}

const isDirectRun =
  process.argv[1] && (process.argv[1].endsWith('db-init.ts') || process.argv[1].endsWith('db-init.js'));

if (isDirectRun) {
  void (async () => {
    try {
      initDb();
      await seedAdminIfMissing();
      closeDb();
      process.exit(0);
    } catch (err) {
      logger.error('Error inicializando DB', { err: (err as Error).message });
      process.exit(1);
    }
  })();
}
