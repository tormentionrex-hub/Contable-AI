import { describe, it, expect } from 'vitest';
import { buildHoja1Rows, buildHoja2Row } from '../src/lib/sheets.js';
import type { FacturaSchemaJson } from '../src/types/factura.js';

function fakeFactura(overrides: Partial<FacturaSchemaJson['factura']> = {}): FacturaSchemaJson {
  return {
    fuente: 'pdf_nativo',
    confianza_extraccion: 0.95,
    requiere_revision_humana: false,
    motivo_revision: null,
    factura: {
      clave_numerica: '50626112500310200722315100046010000285222100000000',
      consecutivo: '15100046010000285222',
      tipo_documento: 'FE',
      fecha_emision: '2025-11-26',
      moneda: 'CRC',
      tipo_cambio: 1,
      proveedor: {
        nombre: 'CORPORACION SUPERMERCADOS UNIDOS S.R.L.',
        cedula: '3102007223',
        tipo_cedula: 'juridica',
        actividad_economica: 'Venta al detalle',
      },
      receptor: { nombre: 'FUNDACION CRC ENDURANCE', cedula: '3006696489' },
      lineas: [
        {
          numero_linea: 1,
          descripcion: 'ROMPOPE 1L',
          cantidad: 8,
          precio_unitario: 2592.92,
          monto_total: 23440,
          tarifa_iva_marcada: null,
          tarifa_iva_inferida: 13,
          base_imponible: 20743.36,
          iva_calculado: 2696.64,
        },
        {
          numero_linea: 2,
          descripcion: 'SALS CRI LIZ',
          cantidad: 1,
          precio_unitario: 2504.95,
          monto_total: 2530,
          tarifa_iva_marcada: null,
          tarifa_iva_inferida: 1,
          base_imponible: 2504.95,
          iva_calculado: 25.05,
        },
      ],
      totales: {
        subtotal: 23248.31,
        iva_total: 2721.69,
        total_factura: 25970,
        iva_por_tarifa: { '1': 25.05, '13': 2696.64 },
      },
      ...overrides,
    },
  };
}

describe('buildHoja1Rows — regla de agrupación por tarifa', () => {
  it('CSU Rompope: una fila por tarifa (1% y 13%)', () => {
    const filas = buildHoja1Rows(fakeFactura());
    expect(filas.length).toBe(2);
    // Ambas filas repiten fecha, proveedor, cédula, no.factura y monto del documento.
    expect(filas[0]![0]).toBe('26/11/2025');
    expect(filas[1]![0]).toBe('26/11/2025');
    expect(filas[0]![1]).toBe('CORPORACION SUPERMERCADOS UNIDOS S.R.L.');
    expect(filas[1]![1]).toBe('CORPORACION SUPERMERCADOS UNIDOS S.R.L.');
    expect(filas[0]![6]).toBe(25970); // Monto del documento se repite
    expect(filas[1]![6]).toBe(25970);

    // Las tarifas presentes deben ser 1% (= 0.01) y 13% (= 0.13).
    const tarifas = filas.map((f) => f[8]).sort();
    expect(tarifas).toEqual([0.01, 0.13]);

    // La suma de la columna `Total` (índice 10) por factura debe igualar el monto del documento.
    const sumaTotales = filas.reduce((acc, f) => acc + (f[10] as number), 0);
    expect(sumaTotales).toBeCloseTo(25970, 0);
  });

  it('factura de tarifa única: una sola fila', () => {
    const f = fakeFactura({
      lineas: [
        {
          numero_linea: 1,
          descripcion: 'Caja heavy duty plástica 100lt',
          cantidad: 1,
          precio_unitario: 6900,
          monto_total: 6900,
          tarifa_iva_marcada: 13,
          tarifa_iva_inferida: 13,
          base_imponible: 6106.19,
          iva_calculado: 793.81,
        },
      ],
      totales: {
        subtotal: 6106.19,
        iva_total: 793.81,
        total_factura: 6900,
        iva_por_tarifa: { '13': 793.81 },
      },
    });
    const filas = buildHoja1Rows(f);
    expect(filas.length).toBe(1);
    expect(filas[0]![8]).toBe(0.13);
    expect(filas[0]![10]).toBe(6900);
  });
});

describe('buildHoja2Row — 24 columnas', () => {
  it('genera fila con todas las columnas oficiales', () => {
    const row = buildHoja2Row(fakeFactura());
    expect(row.length).toBe(24);
    expect(row[0]).toBe('50626112500310200722315100046010000285222100000000'); // Clave
    expect(row[1]).toBe('15100046010000285222'); // Consecutivo
    expect(row[2]).toBe('FE'); // Tipo Documento
    expect(row[5]).toBe('2025-11-26'); // Fecha Emisión
    expect(row[11]).toBe('CRC'); // Moneda
    expect(row[12]).toBe(1); // Tipo Cambio
    expect(row[22]).toBe(25970); // Total Factura
  });
});
