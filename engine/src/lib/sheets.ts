/**
 * Capa de Google Sheets para el machote Forward CR.
 *
 * Carga la Service Account desde el JSON local, crea Spreadsheets con 4 hojas
 * (Reintegro Caja Chica, Detalle Hacienda, Resumen por Tarifa, Para Revisión),
 * y escribe filas por factura siguiendo `engine/schemas/sheet-layout.md`.
 *
 * Diseñado para fallar de forma **suave**: si el config no tiene Service Account,
 * el módulo entra en modo deshabilitado y el motor sigue funcionando contra SQLite.
 */

import fs from 'node:fs';
import { google, sheets_v4 } from 'googleapis';
import { JWT } from 'google-auth-library';
import { config } from '../config.js';
import { logger } from './logger.js';
import { getDb } from './db.js';
import type { FacturaSchemaJson, TarifaIVA } from '../types/factura.js';

const log = logger.child({ mod: 'sheets' });

export class SheetsError extends Error {
  constructor(message: string, public detalle?: unknown) {
    super(message);
    this.name = 'SheetsError';
  }
}

// ============================================================
// Modo deshabilitado vs habilitado
// ============================================================

let _sheetsClient: sheets_v4.Sheets | null = null;
let _driveClient: ReturnType<typeof google.drive> | null = null;
let _authClient: JWT | null = null;
let _initFailed = false;

function loadServiceAccount(): JWT {
  if (_authClient) return _authClient;
  if (!config.google.serviceAccountJsonPath) {
    throw new SheetsError(
      'SERVICE_ACCOUNT_NO_CONFIGURADO: defina GOOGLE_SERVICE_ACCOUNT_JSON en .env',
    );
  }
  const raw = fs.readFileSync(config.google.serviceAccountJsonPath, 'utf8');
  const parsed = JSON.parse(raw) as { client_email: string; private_key: string };
  if (!parsed.client_email || !parsed.private_key) {
    throw new SheetsError('El JSON de Service Account no tiene client_email o private_key.');
  }
  _authClient = new JWT({
    email: parsed.client_email,
    key: parsed.private_key,
    scopes: [
      'https://www.googleapis.com/auth/spreadsheets',
      // drive.file solo permite tocar archivos creados por la app → cumple para cuentas
      // personales (sin Workspace) donde el scope `drive` completo no se concede.
      'https://www.googleapis.com/auth/drive.file',
    ],
  });
  return _authClient;
}

export function isSheetsEnabled(): boolean {
  return !!config.google.serviceAccountJsonPath && !_initFailed;
}

function sheetsClient(): sheets_v4.Sheets {
  if (_sheetsClient) return _sheetsClient;
  const auth = loadServiceAccount();
  _sheetsClient = google.sheets({ version: 'v4', auth });
  return _sheetsClient;
}

function driveClient() {
  if (_driveClient) return _driveClient;
  const auth = loadServiceAccount();
  _driveClient = google.drive({ version: 'v3', auth });
  return _driveClient;
}

// ============================================================
// Constantes de layout (acoplado a sheet-layout.md)
// ============================================================

const HEADERS_H1 = [
  'Fecha',
  'Proveedor',
  'Cédula',
  'No. Factura',
  'Descripción',
  'Moneda',
  'Monto del documento',
  'Monto Gravado',
  '% IVA',
  'Monto IVA',
  'Total',
];

const HEADERS_H2 = [
  'Clave', 'Numeración Consecutiva', 'Tipo Documento', 'Consecutivo Nota Referencia',
  'Actividad Económica', 'Fecha Emisión', 'Fecha de carga', 'Nombre Proveedor',
  'Tipo Cédula', 'Cédula Proveedor', 'Estado Hacienda', 'Moneda', 'Tipo Cambio',
  'Total Gravado', 'Total Exento', 'Descuento', 'SubTotal', 'Sub total Colones',
  'Otros Cargos', 'Porcentaje Impuesto', 'Total Impuesto', 'Impuesto en Colones',
  'Total Factura', 'Total Colones',
];

const HEADERS_H4 = [...HEADERS_H1, 'Motivo de revisión'];

const HEADER_BG = { red: 0x6b / 255, green: 0x2c / 255, blue: 0x8f / 255 }; // #6B2C8F
const HEADER_FG = { red: 1, green: 1, blue: 1 };
const REVISION_BG = { red: 0xff / 255, green: 0xf3 / 255, blue: 0xcd / 255 }; // #FFF3CD

// ============================================================
// Crear el machote (Spreadsheet con 4 hojas)
// ============================================================

export interface CreateMachoteResult {
  sheet_id: string;
  url: string;
  hoja_ids: Record<string, number>;
}

export async function createMachote(args: {
  empresa_nombre: string;
  empresa_id: string;
  compartirCon?: string; // email
}): Promise<CreateMachoteResult> {
  if (!isSheetsEnabled()) {
    throw new SheetsError('Sheets deshabilitado: falta Service Account.');
  }
  const sheets = sheetsClient();
  const drive = driveClient();
  const title = `FWD Contable AI — ${args.empresa_nombre} (${args.empresa_id})`;

  // Paso 1: intentar crear el archivo. Las Service Accounts en cuentas Google personales
  // NO tienen quota de Drive (0 GB) y devuelven "storage quota exceeded" al crear.
  // En ese caso, requerimos que el usuario haya pre-creado el Sheet vacío y lo haya
  // compartido con la SA — pasandonos el ID por config.google.sheetIdFundacionCrc.
  let spreadsheetId: string;
  try {
    const fileRes = await drive.files.create({
      requestBody: {
        name: title,
        mimeType: 'application/vnd.google-apps.spreadsheet',
      },
      fields: 'id',
    });
    spreadsheetId = fileRes.data.id!;
  } catch (err) {
    const msg = (err as Error).message;
    if (msg.includes('storage quota') || msg.includes('storageQuotaExceeded')) {
      throw new SheetsError(
        'NO_DRIVE_QUOTA: La Service Account no tiene quota en Drive (común en cuentas Google personales). ' +
          'Workaround: creá manualmente un Google Sheet vacío en tu Drive, compartilo como editor con ' +
          'la Service Account, y poné el ID del Sheet en GOOGLE_SHEET_ID_FUNDACION_CRC del .env. ' +
          'Después corré `npm run sheets:setup` de nuevo.',
        { spreadsheetId: undefined },
      );
    }
    throw err;
  }

  // Paso 2: renombrar las hojas default + agregar las 4 nuestras.
  return await applyMachoteToSpreadsheet({
    spreadsheetId,
    compartirCon: args.compartirCon,
  });
}

/**
 * Aplica las 4 hojas + headers + fórmulas a un Spreadsheet ya creado.
 * Útil cuando el Sheet fue creado por el usuario en su Drive y solo nos da el ID.
 */
export async function applyMachoteToSpreadsheet(args: {
  spreadsheetId: string;
  compartirCon?: string;
}): Promise<CreateMachoteResult> {
  if (!isSheetsEnabled()) {
    throw new SheetsError('Sheets deshabilitado: falta Service Account.');
  }
  const sheets = sheetsClient();
  const spreadsheetId = args.spreadsheetId;

  // Inspeccionar hojas existentes.
  const meta = await sheets.spreadsheets.get({ spreadsheetId });
  const existing = (meta.data.sheets ?? []).map((s) => ({
    sheetId: s.properties?.sheetId ?? 0,
    title: s.properties?.title ?? '',
  }));
  const titlesNeeded = ['Reintegro Caja Chica', 'Detalle Hacienda', 'Resumen por Tarifa', 'Para Revisión'];
  const titlesExisting = new Set(existing.map((s) => s.title));

  const addRequests: sheets_v4.Schema$Request[] = [];

  // Renombramos la primera hoja default (típicamente "Sheet1" / "Hoja 1") a "Reintegro Caja Chica"
  // si esa no existe aún.
  if (!titlesExisting.has('Reintegro Caja Chica') && existing.length > 0) {
    addRequests.push({
      updateSheetProperties: {
        properties: {
          sheetId: existing[0]!.sheetId,
          title: 'Reintegro Caja Chica',
          gridProperties: { frozenRowCount: 5 },
        },
        fields: 'title,gridProperties.frozenRowCount',
      },
    });
    titlesExisting.add('Reintegro Caja Chica');
    existing[0]!.title = 'Reintegro Caja Chica';
  }
  for (const t of titlesNeeded) {
    if (!titlesExisting.has(t)) {
      addRequests.push({
        addSheet: { properties: { title: t, gridProperties: { frozenRowCount: t === 'Reintegro Caja Chica' ? 5 : 1 } } },
      });
    }
  }

  let addRes: sheets_v4.Schema$BatchUpdateSpreadsheetResponse = { replies: [] };
  if (addRequests.length > 0) {
    const r = await sheets.spreadsheets.batchUpdate({
      spreadsheetId,
      requestBody: { requests: addRequests },
    });
    addRes = r.data;
  }

  const hojaIds: Record<string, number> = {};
  for (const s of existing) hojaIds[s.title] = s.sheetId;
  for (const r of addRes.replies ?? []) {
    if (r.addSheet?.properties?.title && typeof r.addSheet.properties.sheetId === 'number') {
      hojaIds[r.addSheet.properties.title] = r.addSheet.properties.sheetId;
    }
  }

  // Aplicar headers + formato.
  const requests: sheets_v4.Schema$Request[] = [];

  // ------------- Hoja 1: Reintegro Caja Chica (encabezado fila 5) -------------
  // Fila 1: título Forward CR
  requests.push({
    updateCells: {
      range: { sheetId: hojaIds['Reintegro Caja Chica']!, startRowIndex: 0, endRowIndex: 1, startColumnIndex: 0, endColumnIndex: 11 },
      rows: [
        {
          values: [
            {
              userEnteredValue: { stringValue: `FORWARD COSTA RICA — Reintegro de Caja Chica` },
              userEnteredFormat: {
                backgroundColor: HEADER_BG,
                textFormat: { foregroundColor: HEADER_FG, bold: true, fontSize: 14 },
                horizontalAlignment: 'CENTER',
              },
            },
          ],
        },
      ],
      fields: 'userEnteredValue,userEnteredFormat(backgroundColor,textFormat,horizontalAlignment)',
    },
  });
  requests.push({
    mergeCells: {
      range: { sheetId: hojaIds['Reintegro Caja Chica']!, startRowIndex: 0, endRowIndex: 1, startColumnIndex: 0, endColumnIndex: 11 },
      mergeType: 'MERGE_ALL',
    },
  });
  // Fila 3: Nombre / Fecha
  requests.push({
    updateCells: {
      range: { sheetId: hojaIds['Reintegro Caja Chica']!, startRowIndex: 2, endRowIndex: 3, startColumnIndex: 0, endColumnIndex: 11 },
      rows: [
        {
          values: [
            { userEnteredValue: { stringValue: 'Nombre:' }, userEnteredFormat: { textFormat: { bold: true } } },
            {}, {}, {}, {},
            { userEnteredValue: { stringValue: 'Fecha:' }, userEnteredFormat: { textFormat: { bold: true } } },
            { userEnteredValue: { formulaValue: '=TODAY()' }, userEnteredFormat: { numberFormat: { type: 'DATE', pattern: 'dd/mm/yyyy' } } },
          ],
        },
      ],
      fields: 'userEnteredValue,userEnteredFormat',
    },
  });
  // Fila 5: headers
  requests.push({
    updateCells: {
      range: { sheetId: hojaIds['Reintegro Caja Chica']!, startRowIndex: 4, endRowIndex: 5, startColumnIndex: 0, endColumnIndex: HEADERS_H1.length },
      rows: [{ values: HEADERS_H1.map((h) => headerCell(h)) }],
      fields: 'userEnteredValue,userEnteredFormat',
    },
  });

  // ------------- Hoja 2: Detalle Hacienda (header fila 1) -------------
  requests.push({
    updateCells: {
      range: { sheetId: hojaIds['Detalle Hacienda']!, startRowIndex: 0, endRowIndex: 1, startColumnIndex: 0, endColumnIndex: HEADERS_H2.length },
      rows: [{ values: HEADERS_H2.map((h) => headerCell(h)) }],
      fields: 'userEnteredValue,userEnteredFormat',
    },
  });

  // ------------- Hoja 3: Resumen por Tarifa (header + fórmulas SUMIF) -------------
  const resumenRows: sheets_v4.Schema$RowData[] = [
    {
      values: ['Tarifa IVA', '# Líneas', 'Base Gravable CRC', 'Monto IVA CRC', 'Total con IVA CRC', '% del Total'].map(
        (h) => headerCell(h),
      ),
    },
  ];
  const tarifas = ['0%', '1%', '2%', '4%', '13%'];
  for (let i = 0; i < tarifas.length; i++) {
    const t = tarifas[i]!;
    // % IVA en hoja 1 está en columna I, Gravado en H, Monto IVA en J, Total en K.
    const cond = `'Reintegro Caja Chica'!I:I,"${t}"`;
    resumenRows.push({
      values: [
        { userEnteredValue: { stringValue: t } },
        { userEnteredValue: { formulaValue: `=COUNTIF(${cond})` } },
        { userEnteredValue: { formulaValue: `=SUMIF(${cond},'Reintegro Caja Chica'!H:H)` }, userEnteredFormat: crcFormat() },
        { userEnteredValue: { formulaValue: `=SUMIF(${cond},'Reintegro Caja Chica'!J:J)` }, userEnteredFormat: crcFormat() },
        { userEnteredValue: { formulaValue: `=SUMIF(${cond},'Reintegro Caja Chica'!K:K)` }, userEnteredFormat: crcFormat() },
        { userEnteredValue: { formulaValue: `=IFERROR(E${i + 2}/SUM($E$2:$E$6),0)` }, userEnteredFormat: { numberFormat: { type: 'PERCENT', pattern: '0.0%' } } },
      ],
    });
  }
  // Fila Total
  resumenRows.push({
    values: [
      { userEnteredValue: { stringValue: 'Total' }, userEnteredFormat: { textFormat: { bold: true } } },
      { userEnteredValue: { formulaValue: '=SUM(B2:B6)' }, userEnteredFormat: { textFormat: { bold: true } } },
      { userEnteredValue: { formulaValue: '=SUM(C2:C6)' }, userEnteredFormat: { ...crcFormat(), textFormat: { bold: true } } },
      { userEnteredValue: { formulaValue: '=SUM(D2:D6)' }, userEnteredFormat: { ...crcFormat(), textFormat: { bold: true } } },
      { userEnteredValue: { formulaValue: '=SUM(E2:E6)' }, userEnteredFormat: { ...crcFormat(), textFormat: { bold: true } } },
      { userEnteredValue: { stringValue: '100%' }, userEnteredFormat: { textFormat: { bold: true }, horizontalAlignment: 'RIGHT' } },
    ],
  });
  requests.push({
    updateCells: {
      range: { sheetId: hojaIds['Resumen por Tarifa']!, startRowIndex: 0, endRowIndex: resumenRows.length, startColumnIndex: 0, endColumnIndex: 6 },
      rows: resumenRows,
      fields: 'userEnteredValue,userEnteredFormat',
    },
  });

  // ------------- Hoja 4: Para Revisión (header) -------------
  requests.push({
    updateCells: {
      range: { sheetId: hojaIds['Para Revisión']!, startRowIndex: 0, endRowIndex: 1, startColumnIndex: 0, endColumnIndex: HEADERS_H4.length },
      rows: [{ values: HEADERS_H4.map((h) => headerCell(h)) }],
      fields: 'userEnteredValue,userEnteredFormat',
    },
  });

  await sheets.spreadsheets.batchUpdate({
    spreadsheetId,
    requestBody: { requests },
  });

  // Compartir con el contador como writer.
  if (args.compartirCon) {
    try {
      await driveClient().permissions.create({
        fileId: spreadsheetId,
        sendNotificationEmail: true,
        requestBody: { type: 'user', role: 'writer', emailAddress: args.compartirCon },
      });
      log.info('Sheet compartido', { spreadsheetId, con: args.compartirCon });
    } catch (err) {
      log.warn('No se pudo compartir el Sheet', {
        err: (err as Error).message,
        spreadsheetId,
      });
    }
  }

  return {
    sheet_id: spreadsheetId,
    url: `https://docs.google.com/spreadsheets/d/${spreadsheetId}`,
    hoja_ids: hojaIds,
  };
}

function headerCell(text: string): sheets_v4.Schema$CellData {
  return {
    userEnteredValue: { stringValue: text },
    userEnteredFormat: {
      backgroundColor: HEADER_BG,
      textFormat: { foregroundColor: HEADER_FG, bold: true },
      horizontalAlignment: 'CENTER',
    },
  };
}

function crcFormat(): sheets_v4.Schema$CellFormat {
  return { numberFormat: { type: 'CURRENCY', pattern: '₡#,##0.00' }, horizontalAlignment: 'RIGHT' };
}

// ============================================================
// Construcción de filas a partir de la factura
// ============================================================

/**
 * Construye las filas de la Hoja 1 (Reintegro Caja Chica) siguiendo la regla
 * de agrupación: una fila por tarifa de IVA distinta presente en la factura.
 */
export function buildHoja1Rows(factura: FacturaSchemaJson): unknown[][] {
  const f = factura.factura;
  const lineasPorTarifa = new Map<TarifaIVA, { base: number; iva: number; total: number; count: number }>();
  for (const l of f.lineas) {
    const t = (l.tarifa_iva_inferida ?? l.tarifa_iva_marcada ?? 13) as TarifaIVA;
    const e = lineasPorTarifa.get(t) ?? { base: 0, iva: 0, total: 0, count: 0 };
    e.base += l.base_imponible ?? 0;
    e.iva += l.iva_calculado ?? 0;
    e.total += l.monto_total ?? 0;
    e.count += 1;
    lineasPorTarifa.set(t, e);
  }

  const tarifas: TarifaIVA[] = [0, 1, 2, 4, 13];
  const filas: unknown[][] = [];
  const fechaDdMmYyyy = isoToDdmmyyyy(f.fecha_emision);
  for (const t of tarifas) {
    const e = lineasPorTarifa.get(t);
    if (!e) continue;
    filas.push([
      fechaDdMmYyyy,
      f.proveedor.nombre,
      f.proveedor.cedula,
      f.consecutivo ?? '',
      `${e.count} artículo${e.count === 1 ? '' : 's'} (IVA ${t}%)`,
      f.moneda,
      f.totales.total_factura,
      round2(e.base),
      t / 100, // formato 0% en celda
      round2(e.iva),
      round2(e.total),
    ]);
  }
  return filas;
}

export function buildHoja2Row(factura: FacturaSchemaJson): unknown[] {
  const f = factura.factura;
  const tc = f.tipo_cambio ?? 1;
  const fechaCarga = new Date().toISOString().slice(0, 10);
  return [
    f.clave_numerica ?? '',
    f.consecutivo ?? '',
    f.tipo_documento ?? '',
    '', // Consecutivo Nota Referencia (NC/ND, vacío para FE/TE)
    f.proveedor.actividad_economica ?? '',
    f.fecha_emision,
    fechaCarga,
    f.proveedor.nombre,
    f.proveedor.tipo_cedula ?? '',
    f.proveedor.cedula,
    '', // Estado Hacienda (lo llena el motor en columna L'-ish via campo aparte)
    f.moneda,
    tc,
    round2(f.totales.total_gravado ?? 0),
    round2(f.totales.total_exento ?? 0),
    round2(f.totales.descuento_total ?? 0),
    round2(f.totales.subtotal),
    round2(f.totales.subtotal * tc),
    0, // Otros Cargos
    primerTarifaConIva(f),
    round2(f.totales.iva_total),
    round2(f.totales.iva_total * tc),
    round2(f.totales.total_factura),
    round2(f.totales.total_factura * tc),
  ];
}

function primerTarifaConIva(f: FacturaSchemaJson['factura']): number {
  for (const l of f.lineas) {
    const t = l.tarifa_iva_inferida ?? l.tarifa_iva_marcada;
    if (t !== null && t !== undefined && t > 0) return t / 100;
  }
  return 0;
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

function isoToDdmmyyyy(iso: string): string {
  const m = iso.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!m) return iso;
  return `${m[3]}/${m[2]}/${m[1]}`;
}

// ============================================================
// Append + Idempotencia
// ============================================================

export interface AppendResult {
  hojas_escritas: string[];
  filas: { reintegro: number; detalle: number };
  actualizado: boolean;
}

/**
 * Escribe la factura en Hoja 1 (Reintegro) y Hoja 2 (Detalle Hacienda).
 * Idempotencia: si la clave_numerica ya está en la columna A de la Hoja 2,
 * borra las filas previas de esa factura en ambas hojas antes de re-escribir.
 */
export async function appendFactura(args: {
  sheetId: string;
  factura: FacturaSchemaJson;
}): Promise<AppendResult> {
  if (!isSheetsEnabled()) {
    throw new SheetsError('Sheets deshabilitado: falta Service Account.');
  }
  const sheets = sheetsClient();
  const clave = args.factura.factura.clave_numerica;

  let actualizado = false;
  if (clave) {
    actualizado = await deleteFacturaIfExists(sheets, args.sheetId, clave);
  }

  const hoja1Rows = buildHoja1Rows(args.factura);
  const hoja2Row = buildHoja2Row(args.factura);

  // Append Hoja 1
  if (hoja1Rows.length > 0) {
    await sheets.spreadsheets.values.append({
      spreadsheetId: args.sheetId,
      range: "'Reintegro Caja Chica'!A6",
      valueInputOption: 'USER_ENTERED',
      insertDataOption: 'INSERT_ROWS',
      requestBody: { values: hoja1Rows },
    });
  }

  // Append Hoja 2
  await sheets.spreadsheets.values.append({
    spreadsheetId: args.sheetId,
    range: "'Detalle Hacienda'!A2",
    valueInputOption: 'USER_ENTERED',
    insertDataOption: 'INSERT_ROWS',
    requestBody: { values: [hoja2Row] },
  });

  return {
    hojas_escritas: hoja1Rows.length > 0 ? ['Reintegro Caja Chica', 'Detalle Hacienda'] : ['Detalle Hacienda'],
    filas: { reintegro: hoja1Rows.length, detalle: 1 },
    actualizado,
  };
}

async function deleteFacturaIfExists(
  sheets: sheets_v4.Sheets,
  spreadsheetId: string,
  clave: string,
): Promise<boolean> {
  // Buscar la fila en Hoja 2 (col A = clave).
  const h2 = await sheets.spreadsheets.values.get({
    spreadsheetId,
    range: "'Detalle Hacienda'!A:A",
  });
  const claves = (h2.data.values ?? []) as string[][];
  const idx = claves.findIndex((row) => row[0] === clave);
  if (idx < 1) return false; // 0 es header
  // No borramos físicamente (complejo con merges/fórmulas), solo limpiamos contenido.
  // Para Fase 2 esto es suficiente; en Fase 3 podemos rebuild el Sheet completo.
  await sheets.spreadsheets.values.clear({
    spreadsheetId,
    range: `'Detalle Hacienda'!A${idx + 1}:X${idx + 1}`,
  });
  // TODO(fase-3): para Hoja 1 habría que buscar por consecutivo+proveedor y limpiar las filas
  // duplicadas. Por ahora dejamos las filas viejas y agregamos las nuevas; el contador
  // ve duplicado y puede borrar manualmente, o el rebuild completo de Fase 3 lo limpia.
  return true;
}

// ============================================================
// Hoja 4 — Para Revisión
// ============================================================

const MOTIVO_TRADUCCION: Record<string, string> = {
  OCR_DEGRADADO: 'El escaneo está borroso o tiene anotaciones a mano. Verificá los montos contra el papel.',
  FACTURA_SIN_RECEPTOR: 'La factura no tiene cédula de receptor. Confirmá a qué empresa pertenece.',
  CLAVE_NUMERICA_INVALIDA: 'La clave numérica de Hacienda parece estar mal escrita. Revisá el PDF original.',
  CEDULA_NO_REGISTRADA: 'La cédula del proveedor no aparece en el padrón de Hacienda. Confirmá con el proveedor.',
  CEDULA_INACTIVA: 'El proveedor figura como inactivo en Hacienda. Pedile que regularice antes de pagarle.',
  TARIFA_NO_RECONOCIBLE: 'No se pudo deducir la tarifa de IVA. Marcala manualmente con la del documento.',
  RECONCILIACION_FALLIDA: 'Las tarifas de las líneas no cuadran con el pie de la factura. Revisá los montos.',
  MONEDA_DESCONOCIDA: 'La moneda de la factura no se reconoció. Verificá si es CRC, USD o EUR.',
  TIPO_CAMBIO_NO_DISPONIBLE: 'No se pudo obtener el tipo de cambio para la fecha de la factura. Cargalo a mano.',
  DUPLICADA: 'Esta factura ya estaba cargada en el sistema. Confirmá si es un duplicado o una corrección.',
  FACTURA_OTRA_EMPRESA: 'La factura tiene como receptor a una empresa distinta a la activa. Cargala en el libro correcto.',
};

export async function markRevision(args: {
  sheetId: string;
  factura: FacturaSchemaJson;
}): Promise<void> {
  if (!isSheetsEnabled()) {
    throw new SheetsError('Sheets deshabilitado: falta Service Account.');
  }
  const motivo = args.factura.motivo_revision;
  if (!motivo) return;
  const humano = MOTIVO_TRADUCCION[motivo] ?? motivo;

  const hoja1Rows = buildHoja1Rows(args.factura);
  const filas = hoja1Rows.map((r) => [...r, humano]);

  const sheets = sheetsClient();
  await sheets.spreadsheets.values.append({
    spreadsheetId: args.sheetId,
    range: "'Para Revisión'!A2",
    valueInputOption: 'USER_ENTERED',
    insertDataOption: 'INSERT_ROWS',
    requestBody: { values: filas },
  });
}

// ============================================================
// Bootstrap del Sheet para FUNDACION CRC Endurance
// ============================================================

/**
 * Si la empresa no tiene `sheet_id` en la tabla, crea el machote, lo comparte
 * y guarda el ID. Devuelve el sheet_id resultante.
 */
export async function ensureSheetForEmpresa(empresa_id: string): Promise<string | null> {
  if (!isSheetsEnabled()) {
    log.warn('Sheets deshabilitado; ensureSheetForEmpresa no hace nada', { empresa_id });
    return null;
  }
  const db = getDb();
  const row = db
    .prepare('SELECT id, nombre, sheet_id FROM empresas WHERE id = ?')
    .get(empresa_id) as { id: string; nombre: string; sheet_id: string | null } | undefined;
  if (!row) throw new SheetsError(`Empresa ${empresa_id} no existe`);
  if (row.sheet_id) return row.sheet_id;

  // Si el usuario ya pre-creó un Sheet vacío y lo compartió con la SA, su ID está
  // en el .env. En ese caso, aplicamos el machote SOBRE ese Sheet en lugar de crear uno nuevo
  // (necesario para Service Accounts en cuentas Google personales — no tienen quota de Drive).
  if (config.google.sheetIdFundacionCrc) {
    log.info('Aplicando machote a Sheet pre-creado por el usuario', {
      empresa_id,
      sheet_id: config.google.sheetIdFundacionCrc,
    });
    const result = await applyMachoteToSpreadsheet({
      spreadsheetId: config.google.sheetIdFundacionCrc,
      compartirCon: config.google.contadorEmail,
    });
    db.prepare('UPDATE empresas SET sheet_id = ? WHERE id = ?').run(result.sheet_id, empresa_id);
    return result.sheet_id;
  }

  log.info('Creando machote para empresa', { empresa_id, nombre: row.nombre });
  const result = await createMachote({
    empresa_nombre: row.nombre,
    empresa_id,
    compartirCon: config.google.contadorEmail,
  });
  db.prepare('UPDATE empresas SET sheet_id = ? WHERE id = ?').run(result.sheet_id, empresa_id);
  log.info('Machote creado y guardado en DB', {
    empresa_id,
    sheet_id: result.sheet_id,
    url: result.url,
  });
  return result.sheet_id;
}
