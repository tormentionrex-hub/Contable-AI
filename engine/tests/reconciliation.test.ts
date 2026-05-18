import { describe, it, expect } from 'vitest';
import { reconcileFactura } from '../src/agents/tax-iva.js';
import type { FacturaSchemaJson } from '../src/types/factura.js';

function makeFactura(overrides: Partial<FacturaSchemaJson['factura']> = {}): FacturaSchemaJson {
  return {
    fuente: 'pdf_nativo',
    confianza_extraccion: 0.95,
    requiere_revision_humana: false,
    motivo_revision: null,
    factura: {
      fecha_emision: '2025-11-26',
      moneda: 'CRC',
      proveedor: { nombre: 'TEST', cedula: '3101234567' },
      receptor: { nombre: 'FUNDACION CRC Endurance', cedula: '3006696489' },
      lineas: [],
      totales: {
        subtotal: 0,
        iva_total: 0,
        total_factura: 0,
      },
      ...overrides,
    },
  };
}

describe('reconcileFactura', () => {
  it('coincide exactamente con el pie cuando la suma cuadra', () => {
    const f = makeFactura({
      lineas: [
        {
          numero_linea: 1,
          descripcion: 'ROMPOPE 1L',
          cantidad: 8,
          precio_unitario: 2_592.92,
          monto_total: 23_440,
          tarifa_iva_marcada: null,
          tarifa_iva_inferida: 13,
          base_imponible: 20_743.36,
          iva_calculado: 2_696.64,
        },
        {
          numero_linea: 2,
          descripcion: 'SALS CRI LIZ',
          cantidad: 1,
          precio_unitario: 2_504.95,
          monto_total: 2_530,
          tarifa_iva_marcada: null,
          tarifa_iva_inferida: 1,
          base_imponible: 2_504.95,
          iva_calculado: 25.05,
        },
      ],
      totales: {
        subtotal: 23_248.31,
        iva_total: 2_721.69,
        total_factura: 25_970,
        iva_por_tarifa: { '1': 25.05, '13': 2_696.64 },
      },
    });

    const r = reconcileFactura(f);
    expect(r.ok).toBe(true);
    expect(r.porTarifa['1']!.delta).toBeCloseTo(0, 5);
    expect(r.porTarifa['13']!.delta).toBeCloseTo(0, 5);
  });

  it('detecta error cuando el pie no concuerda con la suma de líneas', () => {
    const f = makeFactura({
      lineas: [
        {
          numero_linea: 1,
          descripcion: 'X',
          cantidad: 1,
          precio_unitario: 1_000,
          monto_total: 1_130,
          tarifa_iva_marcada: null,
          tarifa_iva_inferida: 13,
          base_imponible: 1_000,
          iva_calculado: 130,
        },
      ],
      totales: {
        subtotal: 1_000,
        iva_total: 50, // claramente mal
        total_factura: 1_050,
        iva_por_tarifa: { '13': 50 },
      },
    });

    const r = reconcileFactura(f);
    expect(r.ok).toBe(false);
    expect(Math.abs(r.porTarifa['13']!.delta)).toBeGreaterThan(1);
  });

  it('aplica tolerancia ±max(1, total*0.005) — pasa si el delta cabe dentro', () => {
    const f = makeFactura({
      lineas: [
        {
          numero_linea: 1,
          descripcion: 'X',
          cantidad: 1,
          precio_unitario: 100_000,
          monto_total: 113_000,
          tarifa_iva_marcada: 13,
          tarifa_iva_inferida: 13,
          base_imponible: 100_000,
          iva_calculado: 13_000,
        },
      ],
      totales: {
        subtotal: 100_000,
        iva_total: 13_050, // delta 50 — pasa porque tolerancia = max(1, 13050*0.005) = 65.25
        total_factura: 113_050,
        iva_por_tarifa: { '13': 13_050 },
      },
    });

    const r = reconcileFactura(f);
    expect(r.ok).toBe(true);
  });
});
