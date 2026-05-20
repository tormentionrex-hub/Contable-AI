/**
 * Helpers de formato para el contador costarricense.
 *  - Colones: ₡#.##0,00 (separador miles `.`, decimal `,`).
 *  - Dólares: $1,234.56.
 *  - Fechas: "26 de noviembre de 2025" en respuestas largas; "26/11/2025" en tablas.
 *  - Porcentaje: "13 %" con espacio.
 */

const fmtCRC = new Intl.NumberFormat('es-CR', {
  style: 'currency',
  currency: 'CRC',
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

const fmtUSD = new Intl.NumberFormat('en-US', {
  style: 'currency',
  currency: 'USD',
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

const fmtEUR = new Intl.NumberFormat('es-CR', {
  style: 'currency',
  currency: 'EUR',
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

export function moneda(monto: number | null | undefined, codigo: string = 'CRC'): string {
  if (monto === null || monto === undefined || Number.isNaN(monto)) return '—';
  switch (codigo) {
    case 'CRC':
      return fmtCRC.format(monto);
    case 'USD':
      return fmtUSD.format(monto);
    case 'EUR':
      return fmtEUR.format(monto);
    default:
      return `${codigo} ${monto.toFixed(2)}`;
  }
}

export function porcentaje(valor: number | null | undefined): string {
  if (valor === null || valor === undefined || Number.isNaN(valor)) return '—';
  return `${valor} %`;
}

const MESES_ES = [
  'enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio',
  'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre',
];

/**
 * Las fechas de factura llegan como strings YYYY-MM-DD. Formateamos sin pasar
 * por Date: construir un Date con Date.UTC y luego dejar que Intl convierta a
 * zona horaria local introduce un off-by-one en Costa Rica (UTC-6), porque
 * 2026-05-23T00:00Z = 2026-05-22T18:00 hora local. La factura emitida el 23
 * aparecería como 22. La fecha de factura es un dato calendario sin hora —
 * tratarla como string es lo correcto.
 */
function partesIso(iso: string): { y: string; m: string; d: string } | null {
  const match = iso.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!match) return null;
  return { y: match[1]!, m: match[2]!, d: match[3]! };
}

export function fechaCorta(iso: string | null | undefined): string {
  if (!iso) return '—';
  const p = partesIso(iso);
  return p ? `${p.d}/${p.m}/${p.y}` : iso;
}

export function fechaLarga(iso: string | null | undefined): string {
  if (!iso) return '—';
  const p = partesIso(iso);
  if (!p) return iso;
  const dia = Number(p.d);
  const mes = MESES_ES[Number(p.m) - 1] ?? p.m;
  return `${dia} de ${mes} de ${p.y}`;
}

/** Traducción de motivos de revisión a texto humano (sincronizado con backend/sheets.ts). */
const MOTIVO_HUMANO: Record<string, string> = {
  OCR_DEGRADADO: 'El escaneo está borroso o tiene anotaciones a mano. Verificá los montos contra el papel.',
  FACTURA_SIN_RECEPTOR: 'La factura no tiene cédula de receptor.',
  CLAVE_NUMERICA_INVALIDA: 'La clave numérica de Hacienda parece estar mal.',
  CEDULA_NO_REGISTRADA: 'La cédula del proveedor no aparece en el padrón de Hacienda.',
  CEDULA_INACTIVA: 'El proveedor está inactivo en Hacienda.',
  TARIFA_NO_RECONOCIBLE: 'No se pudo deducir la tarifa de IVA. Marcala manualmente.',
  RECONCILIACION_FALLIDA: 'Las tarifas no cuadran con el pie de la factura.',
  MONEDA_DESCONOCIDA: 'La moneda de la factura no se reconoció.',
  TIPO_CAMBIO_NO_DISPONIBLE: 'No se pudo obtener el tipo de cambio para la fecha. Cargalo a mano.',
  DUPLICADA: 'Esta factura ya estaba cargada.',
  FACTURA_OTRA_EMPRESA: 'La factura es de otra empresa cliente.',
  EXTRACCION_FALLIDA: 'No se pudo extraer la factura completa. Completá los datos a mano.',
  ENRIQUECIMIENTO_FALLIDO: 'La factura se extrajo pero falló el cálculo de IVA. Revisá las tarifas.',
  FECHA_ILEGIBLE: 'La fecha de la factura no se pudo leer con claridad. Verificala contra el documento.',
  FECHA_FUTURA: 'La fecha extraída es posterior a hoy. Confirmá la fecha real de la factura.',
  FECHA_MUY_VIEJA: 'La fecha extraída tiene más de 5 años. Verificala contra el documento.',
  FECHA_INVALIDA: 'La fecha extraída tiene un día o mes fuera de rango. Corregila a mano.',
};

export function motivoHumano(motivo: string | null | undefined): string {
  if (!motivo) return '';
  return MOTIVO_HUMANO[motivo] ?? motivo;
}

/**
 * Formatea una cédula jurídica costarricense (10 dígitos, "3-NNN-NNNNNN") o
 * física (9 dígitos, "N-NNNN-NNNN"). Si el input no calza con esos formatos,
 * lo devuelve tal cual.
 */
export function formatearCedula(cedula: string | null | undefined): string {
  if (!cedula) return '';
  const limpia = cedula.replace(/\D/g, '');
  if (limpia.length === 10) {
    return `${limpia[0]}-${limpia.slice(1, 4)}-${limpia.slice(4)}`;
  }
  if (limpia.length === 9) {
    return `${limpia[0]}-${limpia.slice(1, 5)}-${limpia.slice(5)}`;
  }
  return cedula;
}
