/**
 * Tipos derivados manualmente de schemas/factura.schema.json.
 * El validador runtime (Ajv) es la fuente de verdad; estos tipos son sólo ergonomía TS.
 */

export type Fuente = 'pdf_nativo' | 'pdf_escaneado' | 'xml_hacienda';

export type MotivoRevision =
  | 'OCR_DEGRADADO'
  | 'FACTURA_SIN_RECEPTOR'
  | 'CLAVE_NUMERICA_INVALIDA'
  | 'CEDULA_NO_REGISTRADA'
  | 'CEDULA_INACTIVA'
  | 'TARIFA_NO_RECONOCIBLE'
  | 'RECONCILIACION_FALLIDA'
  | 'MONEDA_DESCONOCIDA'
  | 'TIPO_CAMBIO_NO_DISPONIBLE'
  | 'DUPLICADA'
  | 'FACTURA_OTRA_EMPRESA';

export type TarifaIVA = 0 | 1 | 2 | 4 | 13;
export type Moneda = 'CRC' | 'USD' | 'EUR';
export type TipoDocumento = 'FE' | 'TE' | 'NC' | 'ND';
export type TipoCedula = 'fisica' | 'juridica' | 'dimex' | 'nite';

export interface Proveedor {
  nombre: string;
  tipo_cedula?: TipoCedula | null;
  cedula: string;
  actividad_economica?: string | null;
}

export interface Receptor {
  nombre: string;
  cedula: string;
}

export interface LineaFactura {
  numero_linea: number;
  codigo?: string | null;
  descripcion: string;
  cantidad: number;
  unidad_medida?: string | null;
  precio_unitario: number;
  monto_total: number;
  descuento?: number;
  tarifa_iva_marcada?: TarifaIVA | null;
  tarifa_iva_inferida?: TarifaIVA | null;
  iva_calculado?: number | null;
  base_imponible?: number | null;
}

export interface TotalesFactura {
  subtotal: number;
  total_gravado?: number;
  total_exento?: number;
  total_exonerado?: number;
  descuento_total?: number;
  iva_por_tarifa?: Partial<Record<'0' | '1' | '2' | '4' | '13', number>>;
  iva_total: number;
  total_factura: number;
}

export interface FacturaCore {
  clave_numerica?: string | null;
  consecutivo?: string | null;
  tipo_documento?: TipoDocumento | null;
  fecha_emision: string; // YYYY-MM-DD
  hora_emision?: string | null;
  moneda: Moneda;
  tipo_cambio?: number | null;
  proveedor: Proveedor;
  receptor?: Receptor | null;
  lineas: LineaFactura[];
  totales: TotalesFactura;
}

export interface FacturaSchemaJson {
  fuente: Fuente;
  confianza_extraccion: number;
  requiere_revision_humana: boolean;
  motivo_revision?: MotivoRevision | null;
  factura: FacturaCore;
}

export interface ResumenTaxIva {
  status: 'ok' | 'revision_humana' | 'error';
  factura_id: string;
  tarifas_detectadas: TarifaIVA[];
  total_crc: number;
  motivos_revision: string[];
  mensaje_para_contador: string;
}
