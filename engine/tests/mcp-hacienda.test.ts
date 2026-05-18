import { describe, it, expect, beforeAll, afterEach, beforeEach } from 'vitest';
import { initDb } from '../src/lib/db-init.js';
import { getDb } from '../src/lib/db.js';
import { obtenerTipoCambio, validarCedula, HaciendaError } from '../src/lib/hacienda.js';

let origFetch: typeof globalThis.fetch;

beforeAll(() => {
  initDb();
  origFetch = globalThis.fetch;
});

afterEach(() => {
  globalThis.fetch = origFetch;
});

beforeEach(() => {
  // Vaciamos caches entre tests para no contaminar.
  const db = getDb();
  db.exec("DELETE FROM tipo_cambio_cache WHERE fecha LIKE '2099-%' OR fecha = '2026-05-16'");
  db.exec("DELETE FROM cedulas_cache WHERE cedula = '0000000001' OR cedula = '0000000002'");
});

describe('Hacienda — tipo de cambio', () => {
  it('lee del cache cuando existe el par (fecha, moneda)', async () => {
    const db = getDb();
    db.prepare(
      `INSERT OR REPLACE INTO tipo_cambio_cache (fecha, moneda, compra, venta, fecha_vigente, fuente)
       VALUES (?, ?, ?, ?, ?, ?)`,
    ).run('2099-12-31', 'USD', 500, 510, '2099-12-31', 'hacienda');

    let llamadas = 0;
    globalThis.fetch = (async () => {
      llamadas++;
      return new Response('{}', { status: 200 }) as Response;
    }) as typeof fetch;

    const tc = await obtenerTipoCambio({ fecha: '2099-12-31', moneda: 'USD' });
    expect(tc.compra).toBe(500);
    expect(tc.venta).toBe(510);
    expect(tc.fuente).toBe('cache');
    expect(llamadas).toBe(0); // No tocó la red
  });

  it('cae al fallback Frankfurter cuando Hacienda devuelve 503', { timeout: 15_000 }, async () => {
    let intentos = 0;
    globalThis.fetch = (async (input: RequestInfo | URL) => {
      const url = typeof input === 'string' ? input : input.toString();
      intentos++;
      if (url.includes('api.hacienda.go.cr')) {
        return new Response('upstream error', { status: 503 }) as Response;
      }
      if (url.includes('frankfurter')) {
        return new Response(JSON.stringify({ date: '2099-12-31', rates: { CRC: 519.5 } }), {
          status: 200,
        }) as Response;
      }
      return new Response('not found', { status: 404 }) as Response;
    }) as typeof fetch;

    const tc = await obtenerTipoCambio({ fecha: '2099-12-31', moneda: 'USD' });
    expect(tc.fuente).toBe('fallback_frankfurter');
    expect(tc.compra).toBe(519.5);
    expect(tc.venta).toBe(519.5);
    expect(intentos).toBeGreaterThan(0);
  });
});

describe('Hacienda — validar cédula', () => {
  it('mapea HTTP 404 a { encontrada: false } sin tirar', async () => {
    globalThis.fetch = (async () =>
      new Response(JSON.stringify({ code: 404, status: 'Information no available' }), {
        status: 404,
      }) as Response) as typeof fetch;

    const ced = await validarCedula('0000000001');
    expect(ced.encontrada).toBe(false);
    expect(ced.estado).toBe('no_encontrada');
    expect(ced.nombre).toBeNull();
  });

  it('mapea "Inscrito de Oficio" a estado=inactivo con motivo_estado', async () => {
    globalThis.fetch = (async () =>
      new Response(
        JSON.stringify({
          nombre: 'EMPRESA TEST',
          tipoIdentificacion: '02',
          regimen: { codigo: 1, descripcion: 'Régimen general' },
          situacion: {
            estado: 'Inscrito de Oficio',
            mensaje: 'El emisor tiene condición diferente a "Inscrito"...',
          },
          actividades: [
            { estado: 'A', tipo: 'P', codigo: '6201', descripcion: 'Programación' },
            { estado: 'A', tipo: 'S', codigo: '6202', descripcion: 'Consultoría' },
          ],
        }),
        { status: 200 },
      ) as Response) as typeof fetch;

    const ced = await validarCedula('0000000002');
    expect(ced.encontrada).toBe(true);
    expect(ced.estado).toBe('inactivo');
    expect(ced.motivo_estado).toContain('condición diferente');
    expect(ced.actividad_economica).toBe('Programación'); // primer 'A' + 'P'
    expect(ced.actividades.length).toBe(2);
  });
});
