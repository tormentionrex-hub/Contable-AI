/**
 * Script CLI: crea o configura el Google Sheet machote para FUNDACION CRC Endurance.
 * Uso: `npm run sheets:setup`
 *
 * Estrategia:
 *   1) Si la empresa ya tiene `sheet_id` en la DB, no hace nada.
 *   2) Si .env tiene GOOGLE_SHEET_ID_FUNDACION_CRC, aplica el machote SOBRE ese Sheet.
 *   3) Si no, intenta crear uno nuevo con la Service Account (puede fallar si la SA
 *      no tiene quota de Drive — caso común en cuentas Google personales).
 */

import { initDb } from './db-init.js';
import { closeDb, getDb } from './db.js';
import { ensureSheetForEmpresa, isSheetsEnabled, SheetsError } from './sheets.js';
import { logger } from './logger.js';
import { config } from '../config.js';

async function main(): Promise<void> {
  initDb();
  if (!isSheetsEnabled()) {
    logger.error('Sheets deshabilitado: GOOGLE_SERVICE_ACCOUNT_JSON no apunta a un archivo válido.');
    process.exit(2);
  }

  const empresaId = '3006696489';
  logger.info('Asegurando Sheet para FUNDACION CRC Endurance', { empresaId });

  let sheetId: string | null = null;
  try {
    sheetId = await ensureSheetForEmpresa(empresaId);
  } catch (err) {
    if (err instanceof SheetsError && err.message.startsWith('NO_DRIVE_QUOTA')) {
      // eslint-disable-next-line no-console
      console.log(
        '\n=== Acción manual requerida ===\n' +
          'Las Service Accounts en cuentas Google personales no tienen quota de Drive\n' +
          '(no pueden ser dueñas de archivos). Workaround:\n\n' +
          '1) Abrí https://sheets.google.com y creá un Sheet vacío.\n' +
          '   Nombre sugerido: FWD Contable AI — FUNDACION CRC Endurance (3006696489)\n' +
          '2) Compartilo como EDITOR con esta dirección:\n' +
          `      ${readServiceAccountEmail()}\n` +
          '3) Copiá el ID del Sheet (parte de la URL entre /d/ y /edit).\n' +
          '4) Pegalo en engine/.env:\n' +
          '      GOOGLE_SHEET_ID_FUNDACION_CRC=<el ID>\n' +
          '5) Corré de nuevo: npm run sheets:setup\n\n' +
          'El script va a transformar ese Sheet en el machote (4 hojas + headers + fórmulas).\n',
      );
      process.exit(4);
    }
    throw err;
  }

  if (!sheetId) {
    logger.error('No se pudo crear/recuperar el Sheet');
    process.exit(3);
  }

  const url = `https://docs.google.com/spreadsheets/d/${sheetId}`;
  const db = getDb();
  const row = db.prepare('SELECT sheet_id FROM empresas WHERE id = ?').get(empresaId) as
    | { sheet_id: string | null }
    | undefined;

  logger.info('Sheet listo', {
    sheet_id: sheetId,
    url,
    persistido_en_db: row?.sheet_id === sheetId,
    compartido_con: config.google.contadorEmail ?? '(no compartido)',
  });

  // eslint-disable-next-line no-console
  console.log('\n=== Sheet listo ===');
  // eslint-disable-next-line no-console
  console.log(`ID:  ${sheetId}`);
  // eslint-disable-next-line no-console
  console.log(`URL: ${url}`);
  if (config.google.contadorEmail) {
    // eslint-disable-next-line no-console
    console.log(`Editor invitado: ${config.google.contadorEmail}`);
  }
  // eslint-disable-next-line no-console
  console.log(`\nSi todavía no lo tenés en .env, pegalo:`);
  // eslint-disable-next-line no-console
  console.log(`GOOGLE_SHEET_ID_FUNDACION_CRC=${sheetId}\n`);

  closeDb();
}

function readServiceAccountEmail(): string {
  if (!config.google.serviceAccountJsonPath) return '(SA no configurada)';
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const fs = require('node:fs');
    const j = JSON.parse(fs.readFileSync(config.google.serviceAccountJsonPath, 'utf8'));
    return j.client_email ?? '(no encontrado)';
  } catch {
    return '(no se pudo leer el JSON)';
  }
}

main().catch((err) => {
  logger.error('Error en sheets:setup', { err: (err as Error).message, stack: (err as Error).stack });
  process.exit(1);
});
