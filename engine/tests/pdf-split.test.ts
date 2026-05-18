import { describe, it, expect } from 'vitest';
import { splitMultiInvoicePdf } from '../src/lib/pdf-split.js';
import { loadFixture } from './helpers.js';

describe('splitMultiInvoicePdf', () => {
  it(
    'detecta al menos 5 facturas en el PDF de Caja Chica Santa Ana',
    async () => {
      const buf = loadFixture('Caja Chica Santa Ana Julio 2024.pdf');
      const parts = await splitMultiInvoicePdf(buf);
      expect(parts.length).toBeGreaterThanOrEqual(5);
      // Cada parte tiene que ser un buffer no vacío y "razonable" (> 5 KB).
      for (const p of parts) {
        expect(p.length).toBeGreaterThan(5_000);
      }
    },
    60_000,
  );

  it(
    'no rompe los PDFs con factura única (CSU Rompope)',
    async () => {
      const buf = loadFixture('50626112500310200722315100046010000285222100000000.pdf');
      const parts = await splitMultiInvoicePdf(buf);
      // Devuelve el mismo buffer (o uno solo con el mismo size) cuando es factura única.
      expect(parts.length).toBe(1);
      expect(parts[0]!.length).toBe(buf.length);
    },
    30_000,
  );
});
