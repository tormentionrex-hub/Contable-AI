import { describe, it, expect, beforeAll } from 'vitest';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { initDb } from '../src/lib/db-init.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
import { extractFactura } from '../src/agents/docscan.js';
import { enrichFactura } from '../src/agents/tax-iva.js';
import { loadFixture, approxEqual } from './helpers.js';
import type { FacturaSchemaJson } from '../src/types/factura.js';

const EMPRESA_ID = '3006696489';

beforeAll(() => {
  // Aseguramos que la DB existe y tiene la empresa piloto.
  initDb();
});

async function pipeline(fixtureName: string, mimeType = 'application/pdf'): Promise<FacturaSchemaJson> {
  const buffer = loadFixture(fixtureName);
  const factura = await extractFactura({ buffer, mimeType, filename: fixtureName });
  const { factura: enriched } = await enrichFactura({
    factura,
    empresa_id: EMPRESA_ID,
    storagePath: `tests/fixtures/${fixtureName}`,
  });
  return enriched;
}

describe('DocScan + Tax-IVA pipeline contra PDFs golden', () => {
  it(
    'CSU Rompope: tarifa mixta 1% + 13%, total ₡25.970',
    async () => {
      const f = await pipeline('50626112500310200722315100046010000285222100000000.pdf');

      expect(f.factura.totales.total_factura).toBeCloseTo(25_970, 0);
      expect(f.factura.lineas.length).toBe(2);

      const tarifas = f.factura.lineas
        .map((l) => l.tarifa_iva_inferida ?? l.tarifa_iva_marcada)
        .filter((x): x is number => x !== null && x !== undefined)
        .sort();
      expect(tarifas).toEqual([1, 13]);

      // SALS (1%) ≈ 25.05 ; ROMPOPE (13%) ≈ 2696.64
      const iva1 = f.factura.totales.iva_por_tarifa?.['1'] ?? sumIvaByTarifa(f, 1);
      const iva13 = f.factura.totales.iva_por_tarifa?.['13'] ?? sumIvaByTarifa(f, 13);
      expect(approxEqual(iva1, 25.05, 0.5)).toBe(true);
      expect(approxEqual(iva13, 2_696.64, 1)).toBe(true);
    },
    180_000,
  );

  it(
    'CSU Confites OH: tarifa 13%, total ₡3.760',
    async () => {
      const f = await pipeline('FE CONFITES OH 22 NOVIEMBRE 2025.pdf');

      expect(f.factura.totales.total_factura).toBeCloseTo(3_760, 0);
      expect(f.factura.lineas.length).toBeGreaterThanOrEqual(1);

      const t = f.factura.lineas[0]!.tarifa_iva_inferida ?? f.factura.lineas[0]!.tarifa_iva_marcada;
      expect(t).toBe(13);
    },
    180_000,
  );

  it(
    'Pequeño Mundo Zapote: tarifa marcada 13%, total ₡6.900, proveedor ALPEMUSA/Pequeño Mundo',
    async () => {
      const f = await pipeline('FE PEQUEÑO MUNDO2  CC MAYO 2025.pdf');

      expect(f.factura.totales.total_factura).toBeCloseTo(6_900, 0);
      expect(f.factura.lineas.length).toBe(1);

      const linea = f.factura.lineas[0]!;
      expect(linea.tarifa_iva_marcada).toBe(13);
      expect(linea.tarifa_iva_inferida).toBe(13);

      const nombre = (f.factura.proveedor.nombre ?? '').toLowerCase();
      expect(nombre.includes('alpemusa') || nombre.includes('pequeño mundo') || nombre.includes('pequeno mundo')).toBe(true);
    },
    180_000,
  );

  // Caja Chica Santa Ana = 10 páginas con MÚLTIPLES facturas distintas.
  // En Fase 1 no implementamos splitter. El agente extrae la primera factura legible
  // (Pequeño Mundo Guachipelín). Si querés probarla, descomentá el `.skip`.
  it.skip(
    'Caja Chica Santa Ana — multi-factura (splitter pendiente fase 2+)',
    async () => {
      const buffer = fs.readFileSync(
        path.resolve(__dirname, 'fixtures', 'Caja Chica Santa Ana Julio 2024.pdf'),
      );
      const factura = await extractFactura({
        buffer,
        mimeType: 'application/pdf',
        filename: 'Caja Chica Santa Ana Julio 2024.pdf',
      });
      expect(factura.factura.lineas.length).toBeGreaterThan(0);
    },
    180_000,
  );
});

function sumIvaByTarifa(f: FacturaSchemaJson, tarifa: number): number {
  return f.factura.lineas
    .filter((l) => (l.tarifa_iva_inferida ?? l.tarifa_iva_marcada) === tarifa)
    .reduce((acc, l) => acc + (l.iva_calculado ?? 0), 0);
}
