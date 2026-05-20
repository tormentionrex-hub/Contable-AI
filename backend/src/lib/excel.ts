/**
 * Generación de archivos Excel locales con exceljs.
 *
 * Cubre los dos reportes oficiales del taller:
 *  - Reintegro Caja Chica (P01): 11 columnas + Total CRC + saldo líquido.
 *  - Tax-IVA multihoja (P02): hoja "Detalle Hacienda" (24 columnas oficiales) +
 *    hoja "Resumen por Tarifa" con SUMIF dinámico.
 *
 * El estilo sigue la paleta Forward: header morado (#6B2C8F), filas alternadas
 * gris claro, montos a la derecha con formato ₡#,##0.00, filas de revisión
 * humana resaltadas en amarillo.
 */

import ExcelJS from 'exceljs';
import { getDb } from './db.js';

// ============================================================
// Paleta Forward
// ============================================================
const COLOR_PRIMARY = '6B2C8F';
const COLOR_PRIMARY_DARK = '4F1F6A';
const COLOR_ALT_ROW = 'F4F4F4';
const COLOR_WARNING = 'FFF3CD';
const COLOR_TOTAL = 'E8E2EF';

const FMT_CRC = '"₡"#,##0.00';
const FMT_USD = '"$"#,##0.00';
const FMT_PERCENT = '0%';
const FMT_DATE = 'dd/mm/yyyy';

/**
 * Convierte una fecha de calendario `YYYY-MM-DD` a un `Date` que Excel
 * mostrará exactamente con ese día, sin off-by-one por zona horaria.
 *
 * El problema: si construimos `new Date('2026-05-23T00:00:00')` en un servidor
 * que corre en UTC (ej. contenedor en Easypanel), el Date resultante es las
 * 00:00 UTC del 23. Excel lo serializa como 23/05. PERO el usuario abre el
 * archivo en Costa Rica (UTC-6) y Excel muestra "22/05 18:00", que con el
 * formato dd/mm/yyyy queda "22/05/2026". Bug.
 *
 * Solución: anclar la hora a las 12:00 local. Con offset de hasta ±11 horas
 * no se cruza el límite del día. Funciona en cualquier TZ donde corra el
 * servidor o el cliente.
 */
function parseFechaCalendario(iso: string): Date {
  return new Date(`${iso}T12:00:00`);
}

const MESES_ES_FULL = [
  'enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio',
  'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre',
];

/** Período en formato humano para el header del Excel. */
function formatearPeriodoHumano(opts: { mes?: string; desde?: string; hasta?: string }): string {
  if (opts.mes) {
    const m = opts.mes.match(/^(\d{4})-(\d{2})$/);
    if (m) return `Período: ${MESES_ES_FULL[Number(m[2]) - 1]} de ${m[1]}`;
    return `Período: ${opts.mes}`;
  }
  if (opts.desde || opts.hasta) {
    return `Período: ${opts.desde ?? 'inicio'} → ${opts.hasta ?? 'hoy'}`;
  }
  return 'Período: todas las facturas cargadas';
}

interface FacturaRow {
  id: string;
  empresa_id: string;
  clave_numerica: string | null;
  consecutivo: string | null;
  tipo_documento: string | null;
  fecha_emision: string;
  fecha_procesamiento: string;
  proveedor_cedula: string;
  proveedor_nombre: string | null;
  proveedor_tipo_cedula: string | null;
  proveedor_actividad: string | null;
  receptor_nombre: string | null;
  moneda: string;
  tipo_cambio: number | null;
  subtotal: number;
  total_gravado: number;
  total_exento: number;
  total_exonerado: number;
  descuento_total: number;
  iva_total: number;
  total_factura: number;
  subtotal_crc: number;
  iva_total_crc: number;
  total_crc: number;
  estado_hacienda: string | null;
  requiere_revision_humana: number;
  motivo_revision: string | null;
  estado_pago: string | null;
  fecha_pago: string | null;
}

interface LineaRow {
  factura_id: string;
  numero_linea: number;
  descripcion: string;
  cantidad: number;
  precio_unitario: number;
  monto_total: number;
  tarifa_iva: number;
  base_imponible: number;
  iva_calculado: number;
  base_imponible_crc: number;
  iva_calculado_crc: number;
}

interface AdelantoRow {
  monto_crc: number;
  fecha_entrega: string;
  responsable: string | null;
  estado: string;
  notas: string | null;
}

// ============================================================
// Estilos compartidos
// ============================================================

function applyHeaderStyle(row: ExcelJS.Row, color: string = COLOR_PRIMARY): void {
  row.eachCell((cell) => {
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: color } };
    cell.font = { color: { argb: 'FFFFFF' }, bold: true, size: 11 };
    cell.alignment = { vertical: 'middle', horizontal: 'center', wrapText: true };
    cell.border = {
      top: { style: 'thin', color: { argb: COLOR_PRIMARY_DARK } },
      bottom: { style: 'thin', color: { argb: COLOR_PRIMARY_DARK } },
      left: { style: 'thin', color: { argb: COLOR_PRIMARY_DARK } },
      right: { style: 'thin', color: { argb: COLOR_PRIMARY_DARK } },
    };
  });
  row.height = 26;
}

function applyZebra(ws: ExcelJS.Worksheet, startRow: number, endRow: number): void {
  for (let r = startRow; r <= endRow; r++) {
    if (r % 2 === 0) {
      const row = ws.getRow(r);
      row.eachCell({ includeEmpty: true }, (cell) => {
        if (!cell.fill || (cell.fill as ExcelJS.FillPattern).fgColor?.argb !== COLOR_WARNING) {
          cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: COLOR_ALT_ROW } };
        }
      });
    }
  }
}

function highlightWarningRow(ws: ExcelJS.Worksheet, rowNumber: number): void {
  const row = ws.getRow(rowNumber);
  row.eachCell({ includeEmpty: true }, (cell) => {
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: COLOR_WARNING } };
  });
}

function numToColLetter(n: number): string {
  let s = '';
  let x = n;
  while (x > 0) {
    const m = (x - 1) % 26;
    s = String.fromCharCode(65 + m) + s;
    x = Math.floor((x - 1) / 26);
  }
  return s;
}

/**
 * Cierra una hoja para que parezca un documento profesional, no una hoja
 * de cálculo "infinita":
 *  - Oculta las líneas del grid de Excel.
 *  - Oculta TODAS las columnas posteriores a la última con datos.
 *  - Oculta TODAS las filas posteriores a la última (con un margen de 2 filas).
 *  - Establece el área de impresión y el ajuste a una página de ancho.
 *
 * El efecto es que al abrir el archivo, el contador ve un reporte "enmarcado"
 * en un fondo blanco limpio, sin las casillas vacías que distraen a la derecha
 * y debajo.
 */
function cerrarHojaComoDocumento(
  ws: ExcelJS.Worksheet,
  args: { ultimaColumna: number; ultimaFila: number; viewExtra?: Record<string, unknown> },
): void {
  // 1. Apagar grid de Excel y conservar el frozen pane si lo había.
  const viewPrev = (ws.views?.[0] ?? {}) as Record<string, unknown>;
  ws.views = [
    {
      ...viewPrev,
      ...(args.viewExtra ?? {}),
      showGridLines: false,
    } as ExcelJS.WorksheetView,
  ];

  // 2. Ocultar columnas vacías a la derecha. Bajamos hasta col 80 (CB) que es
  //    más que suficiente para "cerrar" visualmente cualquier monitor.
  const HIDE_TO_COL = 80;
  for (let c = args.ultimaColumna + 1; c <= HIDE_TO_COL; c++) {
    const col = ws.getColumn(c);
    col.hidden = true;
  }

  // 3. Ocultar filas vacías debajo. Margen de 2 filas blancas como respiro.
  const HIDE_TO_ROW = 500;
  for (let r = args.ultimaFila + 3; r <= HIDE_TO_ROW; r++) {
    ws.getRow(r).hidden = true;
  }

  // 4. Print area + ajuste a página.
  const lastColLetter = numToColLetter(args.ultimaColumna);
  ws.pageSetup.printArea = `A1:${lastColLetter}${args.ultimaFila}`;
  ws.pageSetup.orientation = 'landscape';
  ws.pageSetup.fitToPage = true;
  ws.pageSetup.fitToWidth = 1;
  ws.pageSetup.fitToHeight = 0;
  ws.pageSetup.margins = {
    top: 0.5,
    bottom: 0.5,
    left: 0.4,
    right: 0.4,
    header: 0.2,
    footer: 0.2,
  };
}

/**
 * Aplica un borde delgado morado alrededor del rango. Da la sensación de
 * "documento enmarcado" sobre la hoja blanca sin grid.
 */
function bordearRango(
  ws: ExcelJS.Worksheet,
  startRow: number,
  startCol: number,
  endRow: number,
  endCol: number,
): void {
  const colorArgb = COLOR_PRIMARY_DARK;
  for (let r = startRow; r <= endRow; r++) {
    for (let c = startCol; c <= endCol; c++) {
      const cell = ws.getRow(r).getCell(c);
      const border: Partial<ExcelJS.Borders> = { ...(cell.border ?? {}) };
      if (r === startRow) border.top = { style: 'medium', color: { argb: colorArgb } };
      if (r === endRow) border.bottom = { style: 'medium', color: { argb: colorArgb } };
      if (c === startCol) border.left = { style: 'medium', color: { argb: colorArgb } };
      if (c === endCol) border.right = { style: 'medium', color: { argb: colorArgb } };
      cell.border = border as ExcelJS.Borders;
    }
  }
}

// ============================================================
// Lectura de la DB
// ============================================================

function loadFacturas(args: {
  empresa_id: string;
  mes?: string;
  desde?: string;
  hasta?: string;
  incluir_archivadas?: boolean;
}): FacturaRow[] {
  const db = getDb();
  const where: string[] = ['f.empresa_id = ?'];
  const params: unknown[] = [args.empresa_id];

  if (!args.incluir_archivadas) {
    where.push('COALESCE(f.archivada, 0) = 0');
  }
  if (args.mes) {
    where.push(`strftime('%Y-%m', f.fecha_emision) = ?`);
    params.push(args.mes);
  }
  if (args.desde) {
    where.push('f.fecha_emision >= ?');
    params.push(args.desde);
  }
  if (args.hasta) {
    where.push('f.fecha_emision <= ?');
    params.push(args.hasta);
  }

  return db
    .prepare(
      `SELECT
         f.id, f.empresa_id, f.clave_numerica, f.consecutivo, f.tipo_documento,
         f.fecha_emision, f.fecha_procesamiento, f.proveedor_cedula,
         p.nombre AS proveedor_nombre, p.tipo_cedula AS proveedor_tipo_cedula,
         p.actividad_economica AS proveedor_actividad,
         f.receptor_nombre, f.moneda, f.tipo_cambio,
         f.subtotal, f.total_gravado, f.total_exento, f.total_exonerado,
         f.descuento_total, f.iva_total, f.total_factura,
         f.subtotal_crc, f.iva_total_crc, f.total_crc,
         f.estado_hacienda, f.requiere_revision_humana, f.motivo_revision,
         COALESCE(f.estado_pago, 'pendiente') AS estado_pago,
         f.fecha_pago
       FROM facturas f
       LEFT JOIN proveedores p ON p.cedula = f.proveedor_cedula
       WHERE ${where.join(' AND ')}
       ORDER BY f.fecha_emision ASC, f.fecha_procesamiento ASC`,
    )
    .all(...params) as FacturaRow[];
}

function loadLineasForFacturas(facturaIds: string[]): LineaRow[] {
  if (facturaIds.length === 0) return [];
  const db = getDb();
  const placeholders = facturaIds.map(() => '?').join(',');
  return db
    .prepare(
      `SELECT factura_id, numero_linea, descripcion, cantidad, precio_unitario,
              monto_total, tarifa_iva, base_imponible, iva_calculado,
              base_imponible_crc, iva_calculado_crc
         FROM lineas_factura
        WHERE factura_id IN (${placeholders})
        ORDER BY factura_id, numero_linea`,
    )
    .all(...facturaIds) as LineaRow[];
}

function loadAdelantos(args: {
  empresa_id: string;
  desde?: string;
  hasta?: string;
  incluir_archivadas?: boolean;
}): AdelantoRow[] {
  const db = getDb();
  const where: string[] = ['empresa_id = ?'];
  const params: unknown[] = [args.empresa_id];
  if (!args.incluir_archivadas) where.push('COALESCE(archivada, 0) = 0');
  if (args.desde) {
    where.push('fecha_entrega >= ?');
    params.push(args.desde);
  }
  if (args.hasta) {
    where.push('fecha_entrega <= ?');
    params.push(args.hasta);
  }
  return db
    .prepare(
      `SELECT monto_crc, fecha_entrega, responsable, estado, notas
         FROM adelantos_caja_chica
        WHERE ${where.join(' AND ')}
        ORDER BY fecha_entrega ASC`,
    )
    .all(...params) as AdelantoRow[];
}

function getEmpresa(empresa_id: string): { id: string; nombre: string } | null {
  const db = getDb();
  return (db
    .prepare('SELECT id, nombre FROM empresas WHERE id = ?')
    .get(empresa_id) as { id: string; nombre: string } | undefined) ?? null;
}

// ============================================================
// REPORTE 1 — Reintegro Caja Chica (P01)
// ============================================================
// Una fila por (factura × tarifa) según regla Forward. Si una factura tiene 2
// tarifas (ej. 1% y 13%), aparece como 2 filas con los mismos datos cabecera y
// monto del documento repetido (no sumado).
// ============================================================

export interface ReintegroOptions {
  empresa_id: string;
  mes?: string; // YYYY-MM
  desde?: string;
  hasta?: string;
  /** Si se pasa, suma adelantos abiertos del periodo para calcular saldo líquido. */
  incluirSaldoCajaChica?: boolean;
}

export async function generarExcelReintegroCajaChica(
  opts: ReintegroOptions,
): Promise<{ buffer: Buffer; filename: string; totalCrc: number; saldoLiquido: number | null }> {
  const empresa = getEmpresa(opts.empresa_id);
  if (!empresa) throw new Error(`Empresa ${opts.empresa_id} no existe.`);

  const facturas = loadFacturas(opts);
  const lineas = loadLineasForFacturas(facturas.map((f) => f.id));
  const lineasPorFactura = new Map<string, LineaRow[]>();
  for (const l of lineas) {
    const arr = lineasPorFactura.get(l.factura_id) ?? [];
    arr.push(l);
    lineasPorFactura.set(l.factura_id, arr);
  }

  const wb = new ExcelJS.Workbook();
  wb.creator = 'FWD Contable AI';
  wb.created = new Date();
  const ws = wb.addWorksheet('Reintegro Caja Chica', {
    views: [{ state: 'frozen', ySplit: 5 }],
  });

  // Filas 1-4: cabecera Forward profesional.
  ws.mergeCells('A1:L1');
  ws.getCell('A1').value = 'FORWARD COSTA RICA';
  ws.getCell('A1').font = { bold: true, size: 18, color: { argb: 'FFFFFF' } };
  ws.getCell('A1').alignment = { horizontal: 'center', vertical: 'middle' };
  ws.getCell('A1').fill = {
    type: 'pattern',
    pattern: 'solid',
    fgColor: { argb: COLOR_PRIMARY },
  };
  ws.getRow(1).height = 28;

  ws.mergeCells('A2:L2');
  ws.getCell('A2').value = 'Reintegro de Caja Chica / Viáticos';
  ws.getCell('A2').font = { bold: true, size: 13, color: { argb: COLOR_PRIMARY_DARK } };
  ws.getCell('A2').alignment = { horizontal: 'center', vertical: 'middle' };
  ws.getRow(2).height = 20;

  ws.mergeCells('A3:L3');
  ws.getCell('A3').value = `Empresa: ${empresa.nombre} · Cédula jurídica: ${empresa.id}`;
  ws.getCell('A3').font = { size: 11, italic: true };
  ws.getCell('A3').alignment = { horizontal: 'center' };

  ws.mergeCells('A4:L4');
  const periodoTxt = formatearPeriodoHumano(opts);
  ws.getCell('A4').value = `${periodoTxt}  ·  Generado el ${new Date().toLocaleString('es-CR')}`;
  ws.getCell('A4').font = { size: 10, color: { argb: '666666' } };
  ws.getCell('A4').alignment = { horizontal: 'center' };
  ws.getRow(4).height = 16;

  // Fila 5: headers oficiales (P01) + columna de estado de pago.
  const headers = [
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
    'Estado de pago',
  ];
  ws.getRow(5).values = headers;
  applyHeaderStyle(ws.getRow(5));

  // Anchos.
  ws.columns = [
    { width: 12 }, // Fecha
    { width: 28 }, // Proveedor
    { width: 16 }, // Cédula
    { width: 18 }, // No. Factura
    { width: 38 }, // Descripción
    { width: 8 }, // Moneda
    { width: 16 }, // Monto documento
    { width: 16 }, // Monto Gravado
    { width: 8 }, // % IVA
    { width: 16 }, // Monto IVA
    { width: 16 }, // Total
    { width: 22 }, // Estado de pago
  ];

  // Filas de datos.
  let rowIdx = 6;
  let totalCrc = 0;
  let totalPagadoCrc = 0;
  let totalPendienteCrc = 0;
  const warningRows: number[] = [];

  for (const f of facturas) {
    const ls = lineasPorFactura.get(f.id) ?? [];
    // Agrupar líneas por tarifa.
    const porTarifa = new Map<number, { base: number; iva: number; total: number; cantLineas: number }>();
    for (const l of ls) {
      const e = porTarifa.get(l.tarifa_iva) ?? { base: 0, iva: 0, total: 0, cantLineas: 0 };
      e.base += l.base_imponible;
      e.iva += l.iva_calculado;
      e.total += l.monto_total;
      e.cantLineas += 1;
      porTarifa.set(l.tarifa_iva, e);
    }

    const facturaWarning = f.requiere_revision_humana === 1;

    const estadoPagoTxt =
      f.estado_pago === 'pagada'
        ? f.fecha_pago
          ? `✓ Pagada (${f.fecha_pago})`
          : '✓ Pagada'
        : 'Pendiente de pago';

    const entries = [...porTarifa.entries()].sort(([a], [b]) => a - b);
    if (entries.length === 0) {
      // Factura sin líneas extraídas (OCR degradado). Agregamos una fila stub.
      const row = ws.getRow(rowIdx);
      row.values = [
        parseFechaCalendario(f.fecha_emision),
        f.proveedor_nombre ?? '—',
        f.proveedor_cedula,
        f.consecutivo ?? f.id.slice(-12),
        f.motivo_revision ?? 'Sin líneas detectadas',
        f.moneda,
        f.total_factura,
        0,
        '',
        f.iva_total,
        f.total_factura,
        estadoPagoTxt,
      ];
      formatReintegroRow(row, f.moneda, f.estado_pago === 'pagada');
      if (facturaWarning) warningRows.push(rowIdx);
      totalCrc += f.total_crc;
      rowIdx++;
      continue;
    }

    for (const [tarifa, e] of entries) {
      const row = ws.getRow(rowIdx);
      const descripcion =
        e.cantLineas === 1
          ? (ls.find((l) => l.tarifa_iva === tarifa)?.descripcion ?? '')
          : `${e.cantLineas} líneas (IVA ${tarifa}%)`;
      row.values = [
        parseFechaCalendario(f.fecha_emision),
        f.proveedor_nombre ?? '—',
        f.proveedor_cedula,
        f.consecutivo ?? f.id.slice(-12),
        descripcion,
        f.moneda,
        f.total_factura,
        e.base,
        tarifa / 100,
        e.iva,
        e.base + e.iva,
        estadoPagoTxt,
      ];
      formatReintegroRow(row, f.moneda, f.estado_pago === 'pagada');
      if (facturaWarning) warningRows.push(rowIdx);
      rowIdx++;
    }

    // Sumamos al total CRC (no por fila, sino por factura).
    totalCrc += f.total_crc;
    if (f.estado_pago === 'pagada') totalPagadoCrc += f.total_crc;
    else totalPendienteCrc += f.total_crc;
  }

  if (rowIdx === 6) {
    // No hay facturas para el filtro pedido. Aviso prominente y consejo.
    ws.mergeCells('A6:L6');
    ws.getCell('A6').value =
      `Este reporte no contiene facturas porque ninguna coincide con el período seleccionado (${periodoTxt}).`;
    ws.getCell('A6').alignment = { horizontal: 'center', vertical: 'middle', wrapText: true };
    ws.getCell('A6').font = { italic: true, size: 12, color: { argb: '7A5D00' } };
    ws.getCell('A6').fill = {
      type: 'pattern',
      pattern: 'solid',
      fgColor: { argb: 'FFF8E1' },
    };
    ws.getRow(6).height = 36;

    ws.mergeCells('A7:L7');
    ws.getCell('A7').value =
      'Sugerencia: descargá el Excel sin filtro de mes desde la pantalla "Subir facturas" para ver todas las facturas cargadas, o cambiá el mes en Caja Chica.';
    ws.getCell('A7').alignment = { horizontal: 'center', vertical: 'middle', wrapText: true };
    ws.getCell('A7').font = { size: 10, color: { argb: '666666' } };
    ws.getRow(7).height = 30;

    rowIdx = 8;
  }

  // Zebra striping (sin pisar warnings).
  applyZebra(ws, 6, rowIdx - 1);
  for (const r of warningRows) highlightWarningRow(ws, r);

  // Totales al pie (TOTAL CRC + desglose pagado/pendiente).
  let cursor = rowIdx + 1;

  const totalRowIdx = cursor++;
  ws.mergeCells(`A${totalRowIdx}:J${totalRowIdx}`);
  ws.getCell(`A${totalRowIdx}`).value = 'TOTAL CRC:';
  ws.getCell(`A${totalRowIdx}`).alignment = { horizontal: 'right' };
  ws.getCell(`A${totalRowIdx}`).font = { bold: true };
  ws.getCell(`K${totalRowIdx}`).value = totalCrc;
  ws.getCell(`K${totalRowIdx}`).numFmt = FMT_CRC;
  ws.getCell(`K${totalRowIdx}`).font = { bold: true, size: 12, color: { argb: COLOR_PRIMARY } };
  ws.getCell(`K${totalRowIdx}`).fill = {
    type: 'pattern',
    pattern: 'solid',
    fgColor: { argb: COLOR_TOTAL },
  };

  // Desglose pagado vs pendiente (solo si hay al menos una factura).
  if (rowIdx > 6) {
    const pagadoRow = cursor++;
    ws.mergeCells(`A${pagadoRow}:J${pagadoRow}`);
    ws.getCell(`A${pagadoRow}`).value = 'Monto pagado:';
    ws.getCell(`A${pagadoRow}`).alignment = { horizontal: 'right' };
    ws.getCell(`A${pagadoRow}`).font = { color: { argb: '0B6B2C' } };
    ws.getCell(`K${pagadoRow}`).value = totalPagadoCrc;
    ws.getCell(`K${pagadoRow}`).numFmt = FMT_CRC;
    ws.getCell(`K${pagadoRow}`).font = { bold: true, color: { argb: '0B6B2C' } };

    const pendienteRow = cursor++;
    ws.mergeCells(`A${pendienteRow}:J${pendienteRow}`);
    ws.getCell(`A${pendienteRow}`).value = 'Monto pendiente de pago:';
    ws.getCell(`A${pendienteRow}`).alignment = { horizontal: 'right' };
    ws.getCell(`A${pendienteRow}`).font = { color: { argb: '8A1C14' } };
    ws.getCell(`K${pendienteRow}`).value = totalPendienteCrc;
    ws.getCell(`K${pendienteRow}`).numFmt = FMT_CRC;
    ws.getCell(`K${pendienteRow}`).font = {
      bold: true,
      color: { argb: totalPendienteCrc > 0 ? '8A1C14' : '666666' },
    };
  }

  // Saldo líquido (si se pidió).
  let saldoLiquido: number | null = null;
  if (opts.incluirSaldoCajaChica) {
    const adelantos = loadAdelantos({
      empresa_id: opts.empresa_id,
      desde: opts.desde,
      hasta: opts.hasta,
    });
    const sumaAdelantos = adelantos
      .filter((a) => a.estado === 'abierto')
      .reduce((acc, a) => acc + a.monto_crc, 0);
    saldoLiquido = sumaAdelantos - totalCrc;

    const adRow = cursor++;
    ws.mergeCells(`A${adRow}:J${adRow}`);
    ws.getCell(`A${adRow}`).value = 'Adelantos abiertos:';
    ws.getCell(`A${adRow}`).alignment = { horizontal: 'right' };
    ws.getCell(`K${adRow}`).value = sumaAdelantos;
    ws.getCell(`K${adRow}`).numFmt = FMT_CRC;

    const saldoRow = cursor++;
    ws.mergeCells(`A${saldoRow}:J${saldoRow}`);
    ws.getCell(`A${saldoRow}`).value =
      saldoLiquido >= 0 ? 'Saldo líquido (a devolver):' : 'Saldo (a reponer):';
    ws.getCell(`A${saldoRow}`).alignment = { horizontal: 'right' };
    ws.getCell(`A${saldoRow}`).font = { bold: true };
    ws.getCell(`K${saldoRow}`).value = saldoLiquido;
    ws.getCell(`K${saldoRow}`).numFmt = FMT_CRC;
    ws.getCell(`K${saldoRow}`).font = {
      bold: true,
      color: { argb: saldoLiquido >= 0 ? '0B6B2C' : '8A1C14' },
    };
  }

  // Nota legal al final.
  cursor++; // fila vacía de respiro
  const noteRow = cursor;
  ws.mergeCells(`A${noteRow}:L${noteRow}`);
  ws.getCell(`A${noteRow}`).value =
    'Documento generado automáticamente por FWD Contable AI. ' +
    'Revisar las filas resaltadas en amarillo antes de aprobar.';
  ws.getCell(`A${noteRow}`).font = { size: 9, italic: true, color: { argb: '888888' } };
  ws.getCell(`A${noteRow}`).alignment = { horizontal: 'center' };

  // Marco completo del documento (de header a nota).
  bordearRango(ws, 1, 1, noteRow, 12);

  // Cerrar la hoja para que se vea como un documento, no como spreadsheet infinito.
  cerrarHojaComoDocumento(ws, {
    ultimaColumna: 12, // A-L (incluye Estado de pago)
    ultimaFila: noteRow,
    viewExtra: { state: 'frozen', ySplit: 5 },
  });

  const buffer = await wb.xlsx.writeBuffer();
  const periodoSlug = opts.mes ?? `${opts.desde ?? 'inicio'}_${opts.hasta ?? 'fin'}`;
  const filename = `reintegro-caja-chica-${empresa.id}-${periodoSlug}.xlsx`;
  return { buffer: Buffer.from(buffer), filename, totalCrc, saldoLiquido };
}

function formatReintegroRow(row: ExcelJS.Row, moneda: string, pagada: boolean = false): void {
  const fmtMoneda = moneda === 'USD' ? FMT_USD : FMT_CRC;
  row.getCell(1).numFmt = FMT_DATE;
  row.getCell(7).numFmt = fmtMoneda;
  row.getCell(8).numFmt = fmtMoneda;
  row.getCell(9).numFmt = FMT_PERCENT;
  row.getCell(10).numFmt = fmtMoneda;
  row.getCell(11).numFmt = fmtMoneda;
  for (const col of [7, 8, 10, 11]) {
    row.getCell(col).alignment = { horizontal: 'right' };
  }
  row.getCell(9).alignment = { horizontal: 'center' };
  row.getCell(6).alignment = { horizontal: 'center' };
  // Columna 12: Estado de pago — verde si pagada, ámbar si pendiente.
  const estadoCell = row.getCell(12);
  estadoCell.alignment = { horizontal: 'center', vertical: 'middle' };
  if (pagada) {
    estadoCell.font = { bold: true, color: { argb: '0B6B2C' }, size: 11 };
    estadoCell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'E6F4EA' } };
  } else {
    estadoCell.font = { bold: true, color: { argb: '7A5D00' }, size: 11 };
    estadoCell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF3CD' } };
  }
}

// ============================================================
// REPORTE 2 — Tax-IVA multihoja (P02)
// ============================================================
// Hoja 1: Detalle Hacienda (24 columnas oficiales).
// Hoja 2: Resumen por Tarifa con SUMIF dinámico contra Hoja 1.
// Hoja 3: Para Revisión (filas con requiere_revision_humana = 1).
// ============================================================

export interface TaxIvaOptions {
  empresa_id: string;
  mes?: string;
  desde?: string;
  hasta?: string;
}

export async function generarExcelTaxIva(
  opts: TaxIvaOptions,
): Promise<{ buffer: Buffer; filename: string; totalCrc: number; totalIvaCrc: number }> {
  const empresa = getEmpresa(opts.empresa_id);
  if (!empresa) throw new Error(`Empresa ${opts.empresa_id} no existe.`);

  const facturas = loadFacturas(opts);
  const lineas = loadLineasForFacturas(facturas.map((f) => f.id));

  const wb = new ExcelJS.Workbook();
  wb.creator = 'FWD Contable AI';
  wb.created = new Date();

  // -----------------------------------------------------------
  // Hoja 1: Detalle Hacienda — 24 columnas oficiales
  // -----------------------------------------------------------
  const wsDetalle = wb.addWorksheet('Detalle Hacienda', {
    views: [{ state: 'frozen', ySplit: 5, xSplit: 1 }],
  });

  // Cabecera profesional.
  wsDetalle.mergeCells('A1:Y1');
  wsDetalle.getCell('A1').value = 'FORWARD COSTA RICA — Detalle Hacienda (IVA)';
  wsDetalle.getCell('A1').font = { bold: true, size: 16, color: { argb: 'FFFFFF' } };
  wsDetalle.getCell('A1').alignment = { horizontal: 'center', vertical: 'middle' };
  wsDetalle.getCell('A1').fill = {
    type: 'pattern',
    pattern: 'solid',
    fgColor: { argb: COLOR_PRIMARY },
  };
  wsDetalle.getRow(1).height = 26;

  wsDetalle.mergeCells('A2:Y2');
  wsDetalle.getCell('A2').value = `Empresa: ${empresa.nombre} · Cédula jurídica: ${empresa.id}`;
  wsDetalle.getCell('A2').font = { bold: true, size: 12, color: { argb: COLOR_PRIMARY_DARK } };
  wsDetalle.getCell('A2').alignment = { horizontal: 'center' };

  wsDetalle.mergeCells('A3:Y3');
  const periodoTxt = formatearPeriodoHumano(opts);
  wsDetalle.getCell('A3').value = `${periodoTxt}  ·  Generado el ${new Date().toLocaleString('es-CR')}`;
  wsDetalle.getCell('A3').font = { size: 10, italic: true, color: { argb: '666666' } };
  wsDetalle.getCell('A3').alignment = { horizontal: 'center' };

  wsDetalle.mergeCells('A4:Y4');
  wsDetalle.getCell('A4').value =
    'Las 24 columnas A-X siguen el formato oficial de la Dirección General de Tributación. Columna Y = estado de pago al proveedor. Filas amarillas necesitan revisión humana antes de declarar.';
  wsDetalle.getCell('A4').font = { size: 9, italic: true, color: { argb: '888888' } };
  wsDetalle.getCell('A4').alignment = { horizontal: 'center' };

  // Fila 5: headers oficiales (24).
  const headers24 = [
    'Clave',
    'Numeración Consecutiva',
    'Tipo Documento',
    'Consecutivo Nota Ref.',
    'Actividad Económica',
    'Fecha Emisión',
    'Fecha de Carga',
    'Nombre Proveedor',
    'Tipo Cédula',
    'Cédula Proveedor',
    'Estado Hacienda',
    'Moneda',
    'Tipo Cambio',
    'Total Gravado',
    'Total Exento',
    'Descuento',
    'SubTotal',
    'SubTotal Colones',
    'Otros Cargos',
    'Porcentaje Impuesto',
    'Total Impuesto',
    'Impuesto en Colones',
    'Total Factura',
    'Total Colones',
    'Estado de pago',
  ];
  wsDetalle.getRow(5).values = headers24;
  applyHeaderStyle(wsDetalle.getRow(5));

  wsDetalle.columns = [
    { width: 52, key: 'clave' },
    { width: 22, key: 'consec' },
    { width: 8, key: 'tipo' },
    { width: 18, key: 'consecRef' },
    { width: 22, key: 'actividad' },
    { width: 12, key: 'fechaEmi' },
    { width: 18, key: 'fechaCarga' },
    { width: 28, key: 'nombre' },
    { width: 10, key: 'tipoCedula' },
    { width: 16, key: 'cedula' },
    { width: 13, key: 'estado' },
    { width: 8, key: 'moneda' },
    { width: 10, key: 'tc' },
    { width: 14, key: 'gravado' },
    { width: 12, key: 'exento' },
    { width: 12, key: 'descuento' },
    { width: 14, key: 'subtotal' },
    { width: 16, key: 'subtotalCrc' },
    { width: 12, key: 'otros' },
    { width: 10, key: 'porcentaje' },
    { width: 14, key: 'iva' },
    { width: 14, key: 'ivaCrc' },
    { width: 14, key: 'total' },
    { width: 14, key: 'totalCrc' },
    { width: 22, key: 'estadoPago' },
  ];

  let r = 6;
  let totalCrc = 0;
  let totalIvaCrc = 0;
  const warningRows: number[] = [];

  // Tarifa "principal" de la factura: la mayoritaria por base imponible.
  const tarifaPrincipal = (facturaId: string): number => {
    const ls = lineas.filter((l) => l.factura_id === facturaId);
    if (ls.length === 0) return 13;
    const sum = new Map<number, number>();
    for (const l of ls) sum.set(l.tarifa_iva, (sum.get(l.tarifa_iva) ?? 0) + l.base_imponible);
    let best = 13;
    let bestSum = -1;
    for (const [t, s] of sum) {
      if (s > bestSum) {
        bestSum = s;
        best = t;
      }
    }
    return best;
  };

  for (const f of facturas) {
    const tarifa = tarifaPrincipal(f.id);
    const fmtMoneda = f.moneda === 'USD' ? FMT_USD : FMT_CRC;

    const estadoPagoTxt =
      f.estado_pago === 'pagada'
        ? f.fecha_pago
          ? `✓ Pagada (${f.fecha_pago})`
          : '✓ Pagada'
        : 'Pendiente de pago';

    const row = wsDetalle.getRow(r);
    row.values = [
      f.clave_numerica ?? '',
      f.consecutivo ?? '',
      f.tipo_documento ?? 'FE',
      '',
      f.proveedor_actividad ?? '',
      parseFechaCalendario(f.fecha_emision),
      new Date(f.fecha_procesamiento),
      f.proveedor_nombre ?? '',
      f.proveedor_tipo_cedula ?? '',
      f.proveedor_cedula,
      f.estado_hacienda ?? 'no_consultado',
      f.moneda,
      f.tipo_cambio ?? 1,
      f.total_gravado,
      f.total_exento,
      f.descuento_total,
      f.subtotal,
      f.subtotal_crc,
      0,
      tarifa / 100,
      f.iva_total,
      f.iva_total_crc,
      f.total_factura,
      f.total_crc,
      estadoPagoTxt,
    ];

    row.getCell(6).numFmt = FMT_DATE;
    row.getCell(7).numFmt = 'dd/mm/yyyy hh:mm';
    row.getCell(13).numFmt = '#,##0.0000';
    for (const col of [14, 15, 16, 17, 19, 21, 23]) row.getCell(col).numFmt = fmtMoneda;
    for (const col of [18, 22, 24]) row.getCell(col).numFmt = FMT_CRC;
    row.getCell(20).numFmt = FMT_PERCENT;
    row.getCell(20).alignment = { horizontal: 'center' };
    row.getCell(1).font = { name: 'Consolas', size: 9 };
    row.getCell(2).font = { name: 'Consolas', size: 9 };
    row.getCell(10).font = { name: 'Consolas', size: 9 };

    // Columna 25 (Y): Estado de pago, con color verde/ámbar.
    const estadoCell = row.getCell(25);
    estadoCell.alignment = { horizontal: 'center', vertical: 'middle' };
    if (f.estado_pago === 'pagada') {
      estadoCell.font = { bold: true, color: { argb: '0B6B2C' }, size: 11 };
      estadoCell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'E6F4EA' } };
    } else {
      estadoCell.font = { bold: true, color: { argb: '7A5D00' }, size: 11 };
      estadoCell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF3CD' } };
    }

    if (f.requiere_revision_humana === 1) warningRows.push(r);

    totalCrc += f.total_crc;
    totalIvaCrc += f.iva_total_crc;
    r++;
  }

  if (r === 6) {
    wsDetalle.mergeCells('A6:Y6');
    wsDetalle.getCell('A6').value =
      `No hay facturas que coincidan con el período seleccionado (${periodoTxt}).`;
    wsDetalle.getCell('A6').alignment = { horizontal: 'center', vertical: 'middle', wrapText: true };
    wsDetalle.getCell('A6').font = { italic: true, size: 12, color: { argb: '7A5D00' } };
    wsDetalle.getCell('A6').fill = {
      type: 'pattern',
      pattern: 'solid',
      fgColor: { argb: 'FFF8E1' },
    };
    wsDetalle.getRow(6).height = 36;

    wsDetalle.mergeCells('A7:Y7');
    wsDetalle.getCell('A7').value =
      'Sugerencia: descargá el Excel sin filtro de mes desde "Subir facturas" para ver todas las facturas cargadas, o cambiá el mes en Resumen IVA.';
    wsDetalle.getCell('A7').alignment = { horizontal: 'center', vertical: 'middle', wrapText: true };
    wsDetalle.getCell('A7').font = { size: 10, color: { argb: '666666' } };
    wsDetalle.getRow(7).height = 30;
    r = 8;
  }

  applyZebra(wsDetalle, 6, r - 1);
  for (const wr of warningRows) highlightWarningRow(wsDetalle, wr);

  // Fila de totales en Detalle Hacienda.
  const totalRowDet = r + 1;
  wsDetalle.getCell(`W${totalRowDet}`).value = totalIvaCrc;
  wsDetalle.getCell(`X${totalRowDet}`).value = totalCrc;
  wsDetalle.getCell(`V${totalRowDet}`).value = 'Totales CRC:';
  wsDetalle.getCell(`V${totalRowDet}`).alignment = { horizontal: 'right' };
  wsDetalle.getCell(`V${totalRowDet}`).font = { bold: true };
  wsDetalle.getCell(`W${totalRowDet}`).numFmt = FMT_CRC;
  wsDetalle.getCell(`X${totalRowDet}`).numFmt = FMT_CRC;
  wsDetalle.getCell(`W${totalRowDet}`).font = { bold: true };
  wsDetalle.getCell(`X${totalRowDet}`).font = { bold: true, color: { argb: COLOR_PRIMARY } };

  // Marco + cierre visual de la hoja Detalle Hacienda (ahora 25 columnas).
  bordearRango(wsDetalle, 1, 1, totalRowDet, 25);
  cerrarHojaComoDocumento(wsDetalle, {
    ultimaColumna: 25, // A-Y (Y = estado de pago)
    ultimaFila: totalRowDet,
    viewExtra: { state: 'frozen', ySplit: 5, xSplit: 1 },
  });

  // -----------------------------------------------------------
  // Hoja 2: Resumen por Tarifa
  // -----------------------------------------------------------
  const wsResumen = wb.addWorksheet('Resumen por Tarifa');
  wsResumen.mergeCells('A1:F1');
  wsResumen.getCell('A1').value = 'RESUMEN POR TARIFA DE IVA (CRC)';
  wsResumen.getCell('A1').font = { bold: true, size: 16, color: { argb: 'FFFFFF' } };
  wsResumen.getCell('A1').alignment = { horizontal: 'center', vertical: 'middle' };
  wsResumen.getCell('A1').fill = {
    type: 'pattern',
    pattern: 'solid',
    fgColor: { argb: COLOR_PRIMARY },
  };
  wsResumen.getRow(1).height = 26;

  wsResumen.mergeCells('A2:F2');
  wsResumen.getCell('A2').value = `${empresa.nombre} · ${periodoTxt}`;
  wsResumen.getCell('A2').font = { size: 11, italic: true, color: { argb: COLOR_PRIMARY_DARK } };
  wsResumen.getCell('A2').alignment = { horizontal: 'center' };

  wsResumen.getRow(3).values = ['Tarifa', '# Líneas', 'Base Gravable CRC', 'Monto IVA CRC', 'Total con IVA CRC', '% del Total'];
  applyHeaderStyle(wsResumen.getRow(3));

  wsResumen.columns = [
    { width: 14 },
    { width: 12 },
    { width: 20 },
    { width: 18 },
    { width: 20 },
    { width: 13 },
  ];

  // Agregar resumen real desde lineas.
  const resumenPorTarifa = new Map<number, { cant: number; base: number; iva: number; total: number }>();
  for (const t of [0, 1, 2, 4, 13]) {
    resumenPorTarifa.set(t, { cant: 0, base: 0, iva: 0, total: 0 });
  }
  for (const l of lineas) {
    const e = resumenPorTarifa.get(l.tarifa_iva) ?? { cant: 0, base: 0, iva: 0, total: 0 };
    e.cant += 1;
    e.base += l.base_imponible_crc;
    e.iva += l.iva_calculado_crc;
    e.total += l.base_imponible_crc + l.iva_calculado_crc;
    resumenPorTarifa.set(l.tarifa_iva, e);
  }
  const granTotal = [...resumenPorTarifa.values()].reduce((acc, e) => acc + e.total, 0);

  const tarifasOrden = [0, 1, 2, 4, 13];
  let rr = 4;
  for (const t of tarifasOrden) {
    const e = resumenPorTarifa.get(t)!;
    const row = wsResumen.getRow(rr);
    const pct = granTotal > 0 ? e.total / granTotal : 0;
    row.values = [`${t}%`, e.cant, e.base, e.iva, e.total, pct];
    row.getCell(1).alignment = { horizontal: 'center' };
    row.getCell(2).alignment = { horizontal: 'center' };
    row.getCell(3).numFmt = FMT_CRC;
    row.getCell(4).numFmt = FMT_CRC;
    row.getCell(5).numFmt = FMT_CRC;
    row.getCell(6).numFmt = FMT_PERCENT;
    rr++;
  }

  // Fila gran total.
  const totalSumRow = wsResumen.getRow(rr);
  const totalCant = [...resumenPorTarifa.values()].reduce((acc, e) => acc + e.cant, 0);
  const totalBase = [...resumenPorTarifa.values()].reduce((acc, e) => acc + e.base, 0);
  const totalIva = [...resumenPorTarifa.values()].reduce((acc, e) => acc + e.iva, 0);
  totalSumRow.values = ['TOTAL', totalCant, totalBase, totalIva, granTotal, granTotal > 0 ? 1 : 0];
  totalSumRow.font = { bold: true };
  totalSumRow.getCell(1).alignment = { horizontal: 'center' };
  totalSumRow.getCell(2).alignment = { horizontal: 'center' };
  totalSumRow.getCell(3).numFmt = FMT_CRC;
  totalSumRow.getCell(4).numFmt = FMT_CRC;
  totalSumRow.getCell(5).numFmt = FMT_CRC;
  totalSumRow.getCell(6).numFmt = FMT_PERCENT;
  totalSumRow.eachCell((cell) => {
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: COLOR_TOTAL } };
  });

  // Marco + cierre visual del Resumen.
  bordearRango(wsResumen, 1, 1, rr, 6);
  cerrarHojaComoDocumento(wsResumen, { ultimaColumna: 6, ultimaFila: rr });

  // -----------------------------------------------------------
  // Hoja 3: Para Revisión
  // -----------------------------------------------------------
  const facturasRevision = facturas.filter((f) => f.requiere_revision_humana === 1);
  if (facturasRevision.length > 0) {
    const wsRev = wb.addWorksheet('Para Revisión');
    wsRev.mergeCells('A1:F1');
    wsRev.getCell('A1').value = 'FACTURAS PARA REVISIÓN HUMANA';
    wsRev.getCell('A1').font = { bold: true, size: 16, color: { argb: 'FFFFFF' } };
    wsRev.getCell('A1').alignment = { horizontal: 'center', vertical: 'middle' };
    wsRev.getCell('A1').fill = {
      type: 'pattern',
      pattern: 'solid',
      fgColor: { argb: COLOR_PRIMARY },
    };
    wsRev.getRow(1).height = 26;

    wsRev.mergeCells('A2:F2');
    wsRev.getCell('A2').value =
      'Verificá manualmente estas facturas antes de declararlas a Hacienda. La columna "Motivo" explica por qué el sistema las apartó.';
    wsRev.getCell('A2').font = { size: 10, italic: true, color: { argb: '666666' } };
    wsRev.getCell('A2').alignment = { horizontal: 'center' };

    wsRev.getRow(3).values = ['Fecha', 'Proveedor', 'Cédula', 'No. Factura', 'Total CRC', 'Motivo'];
    applyHeaderStyle(wsRev.getRow(3));
    wsRev.columns = [
      { width: 12 },
      { width: 28 },
      { width: 16 },
      { width: 18 },
      { width: 14 },
      { width: 38 },
    ];

    let rev = 4;
    for (const f of facturasRevision) {
      const row = wsRev.getRow(rev);
      row.values = [
        parseFechaCalendario(f.fecha_emision),
        f.proveedor_nombre ?? '—',
        f.proveedor_cedula,
        f.consecutivo ?? f.id.slice(-12),
        f.total_crc,
        motivoHumano(f.motivo_revision),
      ];
      row.getCell(1).numFmt = FMT_DATE;
      row.getCell(5).numFmt = FMT_CRC;
      highlightWarningRow(wsRev, rev);
      rev++;
    }

    bordearRango(wsRev, 1, 1, rev - 1, 6);
    cerrarHojaComoDocumento(wsRev, { ultimaColumna: 6, ultimaFila: rev - 1 });
  }

  const buffer = await wb.xlsx.writeBuffer();
  const periodoSlug = opts.mes ?? `${opts.desde ?? 'inicio'}_${opts.hasta ?? 'fin'}`;
  const filename = `tax-iva-${empresa.id}-${periodoSlug}.xlsx`;
  return { buffer: Buffer.from(buffer), filename, totalCrc, totalIvaCrc };
}

function motivoHumano(motivo: string | null): string {
  if (!motivo) return 'Revisar';
  const map: Record<string, string> = {
    OCR_DEGRADADO: 'OCR degradado — verificar montos del PDF original',
    RECONCILIACION_FALLIDA: 'Los totales por tarifa no cuadran con el pie',
    TARIFA_NO_RECONOCIBLE: 'No se pudo inferir la tarifa de IVA',
    TIPO_CAMBIO_NO_DISPONIBLE: 'Falta tipo de cambio del día',
    CEDULA_NO_REGISTRADA: 'La cédula del proveedor no está en el padrón',
    CEDULA_INACTIVA: 'El proveedor figura como inactivo en Hacienda',
    FACTURA_SIN_RECEPTOR: 'Factura sin receptor — confirmar a qué empresa pertenece',
    FACTURA_OTRA_EMPRESA: 'La factura es de otra empresa',
    ENRIQUECIMIENTO_FALLIDO: 'El IVA no se calculó automáticamente — completar a mano',
  };
  return map[motivo] ?? motivo;
}

// ============================================================
// REPORTE 3 — Respaldo Completo (antes de limpiar)
// ============================================================
// Excel multi-hoja que captura TODO lo del período en un solo archivo:
//   Hoja 1: "Resumen" — totales generales, conteos, pago/pendiente
//   Hoja 2: "Facturas (Hacienda)" — las 24 columnas oficiales + estado de pago
//   Hoja 3: "Reintegro Caja Chica" — formato Forward con saldo líquido
//   Hoja 4: "Adelantos" — historial de entregas de efectivo
//   Hoja 5: "Resumen por Tarifa IVA" — desglose por 0/1/2/4/13
// ============================================================

export interface RespaldoOptions {
  empresa_id: string;
  mes?: string;
  desde?: string;
  hasta?: string;
}

export async function generarExcelRespaldoCompleto(
  opts: RespaldoOptions,
): Promise<{ buffer: Buffer; filename: string; total_facturas: number; total_crc: number }> {
  const empresa = getEmpresa(opts.empresa_id);
  if (!empresa) throw new Error(`Empresa ${opts.empresa_id} no existe.`);

  const facturas = loadFacturas(opts);
  const lineas = loadLineasForFacturas(facturas.map((f) => f.id));
  const adelantos = loadAdelantos({
    empresa_id: opts.empresa_id,
    desde: opts.desde,
    hasta: opts.hasta,
  });

  const totalCrc = facturas.reduce((acc, f) => acc + f.total_crc, 0);
  const totalIvaCrc = facturas.reduce((acc, f) => acc + f.iva_total_crc, 0);
  const totalPagado = facturas
    .filter((f) => f.estado_pago === 'pagada')
    .reduce((acc, f) => acc + f.total_crc, 0);
  const totalPendiente = totalCrc - totalPagado;

  const wb = new ExcelJS.Workbook();
  wb.creator = 'FWD Contable AI';
  wb.created = new Date();

  // ===========================================================
  // Hoja 1: Resumen general
  // ===========================================================
  const wsRes = wb.addWorksheet('Resumen');
  wsRes.mergeCells('A1:D1');
  wsRes.getCell('A1').value = 'RESPALDO COMPLETO — FWD CONTABLE AI';
  wsRes.getCell('A1').font = { bold: true, size: 18, color: { argb: 'FFFFFF' } };
  wsRes.getCell('A1').alignment = { horizontal: 'center', vertical: 'middle' };
  wsRes.getCell('A1').fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: COLOR_PRIMARY } };
  wsRes.getRow(1).height = 30;

  wsRes.mergeCells('A2:D2');
  wsRes.getCell('A2').value = empresa.nombre;
  wsRes.getCell('A2').font = { bold: true, size: 14, color: { argb: COLOR_PRIMARY_DARK } };
  wsRes.getCell('A2').alignment = { horizontal: 'center' };

  wsRes.mergeCells('A3:D3');
  wsRes.getCell('A3').value = `Cédula jurídica: ${empresa.id} · ${formatearPeriodoHumano(opts)}`;
  wsRes.getCell('A3').font = { size: 11, italic: true };
  wsRes.getCell('A3').alignment = { horizontal: 'center' };

  wsRes.mergeCells('A4:D4');
  wsRes.getCell('A4').value = `Generado el ${new Date().toLocaleString('es-CR')}`;
  wsRes.getCell('A4').font = { size: 10, color: { argb: '666666' } };
  wsRes.getCell('A4').alignment = { horizontal: 'center' };

  const metricas: Array<[string, string | number, string?]> = [
    ['Total de facturas', facturas.length],
    ['Suma total (CRC)', totalCrc, FMT_CRC],
    ['IVA total (CRC)', totalIvaCrc, FMT_CRC],
    ['Monto pagado (CRC)', totalPagado, FMT_CRC],
    ['Monto pendiente de pago (CRC)', totalPendiente, FMT_CRC],
    ['Facturas para revisión humana', facturas.filter((f) => f.requiere_revision_humana === 1).length],
    ['Adelantos de caja chica registrados', adelantos.length],
    ['Suma de adelantos abiertos (CRC)', adelantos.filter((a) => a.estado === 'abierto').reduce((acc, a) => acc + a.monto_crc, 0), FMT_CRC],
  ];

  let rResumen = 6;
  for (const [label, value, fmt] of metricas) {
    wsRes.mergeCells(`A${rResumen}:C${rResumen}`);
    wsRes.getCell(`A${rResumen}`).value = label;
    wsRes.getCell(`A${rResumen}`).font = { bold: true };
    wsRes.getCell(`A${rResumen}`).alignment = { horizontal: 'left' };
    wsRes.getCell(`D${rResumen}`).value = value;
    if (fmt) wsRes.getCell(`D${rResumen}`).numFmt = fmt;
    wsRes.getCell(`D${rResumen}`).alignment = { horizontal: 'right' };
    wsRes.getCell(`D${rResumen}`).font = { bold: true, color: { argb: COLOR_PRIMARY_DARK } };
    if (rResumen % 2 === 0) {
      for (const col of ['A', 'B', 'C', 'D']) {
        wsRes.getCell(`${col}${rResumen}`).fill = {
          type: 'pattern',
          pattern: 'solid',
          fgColor: { argb: COLOR_ALT_ROW },
        };
      }
    }
    rResumen++;
  }
  wsRes.columns = [{ width: 30 }, { width: 12 }, { width: 12 }, { width: 22 }];
  bordearRango(wsRes, 1, 1, rResumen - 1, 4);
  cerrarHojaComoDocumento(wsRes, { ultimaColumna: 4, ultimaFila: rResumen - 1 });

  // ===========================================================
  // Hoja 2: Adelantos
  // ===========================================================
  const wsAd = wb.addWorksheet('Adelantos');
  wsAd.mergeCells('A1:E1');
  wsAd.getCell('A1').value = 'ADELANTOS DE CAJA CHICA';
  wsAd.getCell('A1').font = { bold: true, size: 16, color: { argb: 'FFFFFF' } };
  wsAd.getCell('A1').alignment = { horizontal: 'center', vertical: 'middle' };
  wsAd.getCell('A1').fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: COLOR_PRIMARY } };
  wsAd.getRow(1).height = 26;

  wsAd.getRow(3).values = ['Fecha entrega', 'Monto (CRC)', 'Responsable', 'Estado', 'Notas'];
  applyHeaderStyle(wsAd.getRow(3));
  wsAd.columns = [{ width: 14 }, { width: 18 }, { width: 28 }, { width: 12 }, { width: 38 }];

  let rAd = 4;
  for (const a of adelantos) {
    const row = wsAd.getRow(rAd);
    row.values = [
      parseFechaCalendario(a.fecha_entrega),
      a.monto_crc,
      a.responsable ?? '',
      a.estado,
      a.notas ?? '',
    ];
    row.getCell(1).numFmt = FMT_DATE;
    row.getCell(2).numFmt = FMT_CRC;
    row.getCell(2).alignment = { horizontal: 'right' };
    rAd++;
  }
  if (rAd === 4) {
    wsAd.mergeCells('A4:E4');
    wsAd.getCell('A4').value = 'No hay adelantos en este período.';
    wsAd.getCell('A4').alignment = { horizontal: 'center' };
    wsAd.getCell('A4').font = { italic: true, color: { argb: '888888' } };
    rAd = 5;
  } else {
    applyZebra(wsAd, 4, rAd - 1);
  }
  bordearRango(wsAd, 1, 1, rAd - 1, 5);
  cerrarHojaComoDocumento(wsAd, { ultimaColumna: 5, ultimaFila: rAd - 1 });

  // ===========================================================
  // Hoja 3: Facturas (Hacienda) — formato compacto
  // ===========================================================
  const wsFac = wb.addWorksheet('Facturas');
  wsFac.mergeCells('A1:J1');
  wsFac.getCell('A1').value = 'FACTURAS — FORMATO HACIENDA';
  wsFac.getCell('A1').font = { bold: true, size: 16, color: { argb: 'FFFFFF' } };
  wsFac.getCell('A1').alignment = { horizontal: 'center', vertical: 'middle' };
  wsFac.getCell('A1').fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: COLOR_PRIMARY } };
  wsFac.getRow(1).height = 26;

  wsFac.getRow(3).values = [
    'Fecha',
    'Tipo',
    'Consecutivo',
    'Proveedor',
    'Cédula',
    'Moneda',
    'Subtotal CRC',
    'IVA CRC',
    'Total CRC',
    'Estado de pago',
  ];
  applyHeaderStyle(wsFac.getRow(3));
  wsFac.columns = [
    { width: 12 },
    { width: 8 },
    { width: 22 },
    { width: 30 },
    { width: 14 },
    { width: 8 },
    { width: 14 },
    { width: 14 },
    { width: 14 },
    { width: 22 },
  ];

  let rFac = 4;
  for (const f of facturas) {
    const row = wsFac.getRow(rFac);
    const estadoPagoTxt =
      f.estado_pago === 'pagada'
        ? f.fecha_pago
          ? `Pagada (${f.fecha_pago})`
          : 'Pagada'
        : 'Pendiente';
    row.values = [
      parseFechaCalendario(f.fecha_emision),
      f.tipo_documento ?? 'FE',
      f.consecutivo ?? f.id.slice(-12),
      f.proveedor_nombre ?? '—',
      f.proveedor_cedula,
      f.moneda,
      f.subtotal_crc,
      f.iva_total_crc,
      f.total_crc,
      estadoPagoTxt,
    ];
    row.getCell(1).numFmt = FMT_DATE;
    for (const col of [7, 8, 9]) {
      row.getCell(col).numFmt = FMT_CRC;
      row.getCell(col).alignment = { horizontal: 'right' };
    }
    row.getCell(10).alignment = { horizontal: 'center' };
    if (f.estado_pago === 'pagada') {
      row.getCell(10).font = { bold: true, color: { argb: '0B6B2C' } };
      row.getCell(10).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'E6F4EA' } };
    } else {
      row.getCell(10).font = { bold: true, color: { argb: '7A5D00' } };
      row.getCell(10).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF3CD' } };
    }
    if (f.requiere_revision_humana === 1) highlightWarningRow(wsFac, rFac);
    rFac++;
  }
  if (rFac === 4) {
    wsFac.mergeCells('A4:J4');
    wsFac.getCell('A4').value = 'No hay facturas en este período.';
    wsFac.getCell('A4').alignment = { horizontal: 'center' };
    wsFac.getCell('A4').font = { italic: true, color: { argb: '888888' } };
    rFac = 5;
  } else {
    applyZebra(wsFac, 4, rFac - 1);
  }

  // Fila total al pie.
  const totRow = rFac + 1;
  wsFac.mergeCells(`A${totRow}:H${totRow}`);
  wsFac.getCell(`A${totRow}`).value = 'TOTAL CRC:';
  wsFac.getCell(`A${totRow}`).alignment = { horizontal: 'right' };
  wsFac.getCell(`A${totRow}`).font = { bold: true };
  wsFac.getCell(`I${totRow}`).value = totalCrc;
  wsFac.getCell(`I${totRow}`).numFmt = FMT_CRC;
  wsFac.getCell(`I${totRow}`).font = { bold: true, size: 12, color: { argb: COLOR_PRIMARY } };
  wsFac.getCell(`I${totRow}`).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: COLOR_TOTAL } };
  bordearRango(wsFac, 1, 1, totRow, 10);
  cerrarHojaComoDocumento(wsFac, { ultimaColumna: 10, ultimaFila: totRow });

  // ===========================================================
  // Hoja 4: Resumen por Tarifa IVA
  // ===========================================================
  const wsTar = wb.addWorksheet('Resumen IVA');
  wsTar.mergeCells('A1:E1');
  wsTar.getCell('A1').value = 'RESUMEN POR TARIFA DE IVA';
  wsTar.getCell('A1').font = { bold: true, size: 16, color: { argb: 'FFFFFF' } };
  wsTar.getCell('A1').alignment = { horizontal: 'center', vertical: 'middle' };
  wsTar.getCell('A1').fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: COLOR_PRIMARY } };
  wsTar.getRow(1).height = 26;

  wsTar.getRow(3).values = ['Tarifa', '# Líneas', 'Base Gravable CRC', 'IVA CRC', 'Total CRC'];
  applyHeaderStyle(wsTar.getRow(3));
  wsTar.columns = [{ width: 12 }, { width: 10 }, { width: 18 }, { width: 16 }, { width: 18 }];

  const porTarifa = new Map<number, { cant: number; base: number; iva: number }>();
  for (const t of [0, 1, 2, 4, 13]) porTarifa.set(t, { cant: 0, base: 0, iva: 0 });
  for (const l of lineas) {
    const e = porTarifa.get(l.tarifa_iva)!;
    e.cant += 1;
    e.base += l.base_imponible_crc;
    e.iva += l.iva_calculado_crc;
  }
  let rTar = 4;
  for (const t of [0, 1, 2, 4, 13]) {
    const e = porTarifa.get(t)!;
    const row = wsTar.getRow(rTar);
    row.values = [`${t}%`, e.cant, e.base, e.iva, e.base + e.iva];
    row.getCell(1).alignment = { horizontal: 'center' };
    row.getCell(2).alignment = { horizontal: 'center' };
    for (const col of [3, 4, 5]) {
      row.getCell(col).numFmt = FMT_CRC;
      row.getCell(col).alignment = { horizontal: 'right' };
    }
    rTar++;
  }
  applyZebra(wsTar, 4, rTar - 1);

  const totalTarRow = wsTar.getRow(rTar);
  const totalBase = [...porTarifa.values()].reduce((a, e) => a + e.base, 0);
  const totalIva = [...porTarifa.values()].reduce((a, e) => a + e.iva, 0);
  totalTarRow.values = ['TOTAL', lineas.length, totalBase, totalIva, totalBase + totalIva];
  totalTarRow.font = { bold: true };
  totalTarRow.getCell(1).alignment = { horizontal: 'center' };
  totalTarRow.getCell(2).alignment = { horizontal: 'center' };
  for (const col of [3, 4, 5]) {
    totalTarRow.getCell(col).numFmt = FMT_CRC;
    totalTarRow.getCell(col).alignment = { horizontal: 'right' };
  }
  totalTarRow.eachCell((c) => {
    c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: COLOR_TOTAL } };
  });
  bordearRango(wsTar, 1, 1, rTar, 5);
  cerrarHojaComoDocumento(wsTar, { ultimaColumna: 5, ultimaFila: rTar });

  const buffer = await wb.xlsx.writeBuffer();
  const stamp = new Date().toISOString().slice(0, 10);
  const filename = `respaldo-${empresa.id}-${stamp}.xlsx`;
  return {
    buffer: Buffer.from(buffer),
    filename,
    total_facturas: facturas.length,
    total_crc: totalCrc,
  };
}
