import { XMLParser } from 'fast-xml-parser';

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: '@_',
  removeNSPrefix: true,
  trimValues: true,
  parseTagValue: true,
  parseAttributeValue: true,
});

export interface HaciendaParseResult {
  /** Documento crudo parseado. Estructura depende del tipo de comprobante. */
  raw: unknown;
  /** Tipo de documento detectado (FE/TE/NC/ND) si reconocible. */
  tipoDocumento: 'FE' | 'TE' | 'NC' | 'ND' | null;
  /** Versión detectada (4.3 / 4.4 / etc.) si está presente. */
  version: string | null;
}

const RAIZ_TIPOS: Record<string, 'FE' | 'TE' | 'NC' | 'ND'> = {
  FacturaElectronica: 'FE',
  TiqueteElectronico: 'TE',
  NotaCreditoElectronica: 'NC',
  NotaDebitoElectronica: 'ND',
};

export function parseHaciendaXML(xmlString: string): HaciendaParseResult {
  const json = parser.parse(xmlString) as Record<string, unknown>;

  let tipoDocumento: HaciendaParseResult['tipoDocumento'] = null;
  let root: Record<string, unknown> | null = null;

  for (const [tag, value] of Object.entries(json)) {
    if (tag in RAIZ_TIPOS && typeof value === 'object' && value !== null) {
      tipoDocumento = RAIZ_TIPOS[tag] ?? null;
      root = value as Record<string, unknown>;
      break;
    }
  }

  const version =
    root && typeof root['@_xmlns'] === 'string'
      ? (root['@_xmlns'] as string).match(/v?(\d+\.\d+)/)?.[1] ?? null
      : null;

  return {
    raw: root ?? json,
    tipoDocumento,
    version,
  };
}
