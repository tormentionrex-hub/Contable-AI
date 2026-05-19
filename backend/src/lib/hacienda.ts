/**
 * Cliente HTTP de la API pública del Ministerio de Hacienda CR.
 * Sin auth, sin token, sin tarjeta. Doc: https://api.hacienda.go.cr/docs/
 *
 * Compartido por:
 *  - los endpoints HTTP /hacienda/* (lib/routes/hacienda.ts)
 *  - el MCP in-process hacienda-cr (src/agents/mcp/hacienda-cr.ts)
 *
 * Incluye:
 *  - retry con backoff (2 reintentos: 500ms, 2000ms)
 *  - fallback a Fawaz/Frankfurter para TC cuando Hacienda falla
 *  - cache en SQLite (tipo_cambio_cache + cedulas_cache, TTL 30d)
 *  - normalización USD/EUR a un shape único
 *  - retroceso día a día (máx 7) cuando Hacienda devuelve [] en histórico
 */

import { config } from '../config.js';
import { getDb } from './db.js';
import { logger } from './logger.js';

const log = logger.child({ mod: 'hacienda' });

// ============================================================
// Tipos
// ============================================================

export type Moneda = 'USD' | 'EUR';
export type TcFuente = 'hacienda' | 'cache' | 'fallback_fawaz' | 'fallback_frankfurter';

export interface TipoCambio {
  moneda: Moneda;
  compra: number;
  venta: number;
  fecha_solicitada: string; // YYYY-MM-DD que pidió el cliente
  fecha_vigente: string; // YYYY-MM-DD que devolvió la fuente (puede diferir si era día no hábil)
  fuente: TcFuente;
}

export type EstadoCedula = 'inscrito' | 'inactivo' | 'no_encontrada';

export interface ActividadEconomica {
  estado: string; // 'A' = activo, 'S' = suspendido, etc.
  tipo: string; // 'P' = principal, 'S' = secundaria
  codigo: string;
  descripcion: string;
}

export interface Cedula {
  cedula: string;
  encontrada: boolean;
  nombre: string | null;
  tipo_identificacion: string | null;
  estado: EstadoCedula;
  motivo_estado: string | null;
  actividad_economica: string | null;
  actividades: ActividadEconomica[];
}

export class HaciendaError extends Error {
  constructor(message: string, public detalle?: unknown) {
    super(message);
    this.name = 'HaciendaError';
  }
}

// ============================================================
// Utilidades
// ============================================================

function todayCR(): string {
  // Costa Rica es UTC-6 sin DST. Tomamos el día calendario CR.
  const now = new Date();
  const offset = -6 * 60; // minutos
  const local = new Date(now.getTime() + (offset - now.getTimezoneOffset()) * 60_000);
  return local.toISOString().slice(0, 10);
}

function subtractDays(yyyyMmDd: string, days: number): string {
  const [y, m, d] = yyyyMmDd.split('-').map(Number);
  const date = new Date(Date.UTC(y!, m! - 1, d!));
  date.setUTCDate(date.getUTCDate() - days);
  return date.toISOString().slice(0, 10);
}

async function fetchJson(url: string, opts: { timeoutMs?: number } = {}): Promise<{
  status: number;
  body: unknown;
}> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), opts.timeoutMs ?? 15_000);
  try {
    const res = await fetch(url, { signal: controller.signal });
    const text = await res.text();
    let body: unknown = null;
    try {
      body = text ? JSON.parse(text) : null;
    } catch {
      body = { raw: text };
    }
    return { status: res.status, body };
  } finally {
    clearTimeout(timeout);
  }
}

async function fetchJsonWithRetry(
  url: string,
  opts: { retries?: number; backoffMs?: number[]; timeoutMs?: number } = {},
): Promise<{ status: number; body: unknown }> {
  const retries = opts.retries ?? 2;
  const backoff = opts.backoffMs ?? [500, 2000];
  let lastErr: unknown = null;
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const res = await fetchJson(url, { timeoutMs: opts.timeoutMs });
      // 5xx → reintentar; 4xx → devolver tal cual (las cédulas inexistentes son 404 esperados).
      if (res.status >= 500 && attempt < retries) {
        log.warn('Hacienda 5xx, reintentando', { url, attempt, status: res.status });
        await new Promise((r) => setTimeout(r, backoff[attempt] ?? 1000));
        continue;
      }
      return res;
    } catch (err) {
      lastErr = err;
      log.warn('Hacienda fetch error', { url, attempt, err: (err as Error).message });
      if (attempt < retries) {
        await new Promise((r) => setTimeout(r, backoff[attempt] ?? 1000));
        continue;
      }
    }
  }
  throw new HaciendaError(`Hacienda inaccesible tras ${retries + 1} intentos`, lastErr);
}

// ============================================================
// Tipo de cambio
// ============================================================

const TC_TABLE = 'tipo_cambio_cache';

function readTcFromCache(fecha: string, moneda: Moneda): TipoCambio | null {
  const db = getDb();
  const row = db
    .prepare(
      `SELECT fecha, moneda, compra, venta, fecha_vigente, fuente
       FROM ${TC_TABLE} WHERE fecha = ? AND moneda = ?`,
    )
    .get(fecha, moneda) as
    | {
        fecha: string;
        moneda: Moneda;
        compra: number;
        venta: number;
        fecha_vigente: string;
        fuente: TcFuente;
      }
    | undefined;
  if (!row) return null;
  return {
    moneda: row.moneda,
    compra: row.compra,
    venta: row.venta,
    fecha_solicitada: row.fecha,
    fecha_vigente: row.fecha_vigente,
    fuente: 'cache',
  };
}

function writeTcCache(tc: TipoCambio): void {
  const db = getDb();
  db.prepare(
    `INSERT OR REPLACE INTO ${TC_TABLE} (fecha, moneda, compra, venta, fecha_vigente, fuente)
     VALUES (?, ?, ?, ?, ?, ?)`,
  ).run(
    tc.fecha_solicitada,
    tc.moneda,
    tc.compra,
    tc.venta,
    tc.fecha_vigente,
    tc.fuente === 'cache' ? 'hacienda' : tc.fuente,
  );
}

interface HaciendaDolarResp {
  compra?: { fecha: string; valor: number };
  venta?: { fecha: string; valor: number };
}

interface HaciendaEuroResp {
  fecha: string;
  dolares: number;
  colones: number;
}

async function fetchHaciendaTcHoy(moneda: Moneda): Promise<TipoCambio | null> {
  const endpoint = moneda === 'USD' ? '/indicadores/tc/dolar' : '/indicadores/tc/euro';
  const url = `${config.hacienda.apiUrl}${endpoint}`;
  const { status, body } = await fetchJsonWithRetry(url);
  if (status !== 200 || !body) return null;

  if (moneda === 'USD') {
    const r = body as HaciendaDolarResp;
    if (!r.compra || !r.venta) return null;
    return {
      moneda: 'USD',
      compra: r.compra.valor,
      venta: r.venta.valor,
      fecha_solicitada: r.venta.fecha,
      fecha_vigente: r.venta.fecha,
      fuente: 'hacienda',
    };
  }

  const r = body as HaciendaEuroResp;
  if (!r.colones || !r.fecha) return null;
  // EUR no tiene spread documentado en este endpoint — usamos `colones` en compra y venta.
  return {
    moneda: 'EUR',
    compra: r.colones,
    venta: r.colones,
    fecha_solicitada: r.fecha,
    fecha_vigente: r.fecha,
    fuente: 'hacienda',
  };
}

interface HaciendaHistoricoItem {
  fecha?: string;
  compra?: number;
  venta?: number;
  valor?: number;
}

async function fetchHaciendaTcHistorico(fecha: string, moneda: Moneda): Promise<TipoCambio | null> {
  // El endpoint /historico solo existe para dólar según la doc.
  // Para EUR caemos directamente al fallback Frankfurter histórico no soportado —
  // intentamos /indicadores/tc/euro y aceptamos lo que devuelva (es un único valor diario).
  if (moneda === 'EUR') {
    return fetchHaciendaTcHoy('EUR');
  }

  // Probamos la fecha pedida y, si devuelve [] (día no hábil), retrocedemos hasta 7 días.
  // Si Hacienda devuelve un status que NO es 200 (caída/timeout), abortamos para que
  // el caller active el fallback en vez de loopear N × retries.
  let target = fecha;
  for (let i = 0; i <= 7; i++) {
    const url = `${config.hacienda.apiUrl}/indicadores/tc/dolar/historico?d=${target}&h=${target}`;
    const { status, body } = await fetchJsonWithRetry(url);
    if (status !== 200) {
      // Hacienda caída → salir del loop, dejar que el fallback tome el control.
      return null;
    }
    if (Array.isArray(body) && body.length > 0) {
      const item = body[0] as HaciendaHistoricoItem;
      const compra = typeof item.compra === 'number' ? item.compra : item.valor;
      const venta = typeof item.venta === 'number' ? item.venta : item.valor;
      if (typeof compra === 'number' && typeof venta === 'number') {
        return {
          moneda: 'USD',
          compra,
          venta,
          fecha_solicitada: fecha,
          fecha_vigente: item.fecha ?? target,
          fuente: 'hacienda',
        };
      }
    }
    target = subtractDays(target, 1);
  }
  return null;
}

async function fetchFallbackTc(fecha: string, moneda: Moneda): Promise<TipoCambio | null> {
  // 1) Frankfurter (acepta `from=X&to=CRC`, formato JSON limpio)
  const frankfurterUrl =
    moneda === 'USD' ? config.hacienda.fallbacks.frankfurterUsd : config.hacienda.fallbacks.frankfurterEur;
  try {
    const { status, body } = await fetchJsonWithRetry(frankfurterUrl, { retries: 1 });
    if (status === 200 && body && typeof body === 'object') {
      const b = body as { rates?: { CRC?: number }; date?: string };
      const rate = b.rates?.CRC;
      if (typeof rate === 'number') {
        return {
          moneda,
          compra: rate,
          venta: rate,
          fecha_solicitada: fecha,
          fecha_vigente: b.date ?? fecha,
          fuente: 'fallback_frankfurter',
        };
      }
    }
  } catch (err) {
    log.warn('Fallback Frankfurter falló', { err: (err as Error).message });
  }

  // 2) Fawaz (solo USD por simplicidad; el endpoint estándar es USD-base)
  if (moneda === 'USD') {
    try {
      const { status, body } = await fetchJsonWithRetry(config.hacienda.fallbacks.fawaz, { retries: 1 });
      if (status === 200 && body && typeof body === 'object') {
        const b = body as { date?: string; usd?: { crc?: number } };
        const rate = b.usd?.crc;
        if (typeof rate === 'number') {
          return {
            moneda,
            compra: rate,
            venta: rate,
            fecha_solicitada: fecha,
            fecha_vigente: b.date ?? fecha,
            fuente: 'fallback_fawaz',
          };
        }
      }
    } catch (err) {
      log.warn('Fallback Fawaz falló', { err: (err as Error).message });
    }
  }
  return null;
}

/**
 * API principal: obtiene el TC de la `fecha` en `moneda`.
 * Orden: cache → Hacienda (hoy o histórico) → fallback Frankfurter → fallback Fawaz.
 */
export async function obtenerTipoCambio(args: {
  fecha?: string;
  moneda: Moneda;
}): Promise<TipoCambio> {
  const fecha = args.fecha ?? todayCR();
  const moneda = args.moneda;

  const cached = readTcFromCache(fecha, moneda);
  if (cached) return cached;

  const today = todayCR();
  let tc: TipoCambio | null = null;

  try {
    tc = fecha === today ? await fetchHaciendaTcHoy(moneda) : await fetchHaciendaTcHistorico(fecha, moneda);
  } catch (err) {
    log.warn('Hacienda agotó reintentos, intentando fallback', {
      err: (err as Error).message,
      fecha,
      moneda,
    });
  }

  if (!tc) {
    tc = await fetchFallbackTc(fecha, moneda);
  }

  if (!tc) {
    throw new HaciendaError('TIPO_CAMBIO_NO_DISPONIBLE', { fecha, moneda });
  }

  // Cachear con fecha solicitada (aunque la vigente sea distinta por día no hábil).
  writeTcCache({ ...tc, fecha_solicitada: fecha });
  return tc;
}

export async function tipoCambioActual(moneda: Moneda): Promise<TipoCambio> {
  return obtenerTipoCambio({ moneda });
}

// ============================================================
// Padrón de contribuyentes
// ============================================================

const CACHE_TTL_DAYS = 30;

interface HaciendaPadronResp {
  nombre?: string;
  tipoIdentificacion?: string;
  regimen?: { codigo: number; descripcion: string };
  situacion?: {
    estado?: string;
    mensaje?: string;
    moroso?: string;
    omiso?: string;
  };
  actividades?: ActividadEconomica[];
}

function readCedulaFromCache(cedula: string): Cedula | null {
  const db = getDb();
  const row = db
    .prepare(
      `SELECT cedula, tipo_identificacion, nombre, estado, motivo_estado,
              actividad_economica, actividades_json, consultado
       FROM cedulas_cache WHERE cedula = ?`,
    )
    .get(cedula) as
    | {
        cedula: string;
        tipo_identificacion: string | null;
        nombre: string | null;
        estado: EstadoCedula;
        motivo_estado: string | null;
        actividad_economica: string | null;
        actividades_json: string | null;
        consultado: string;
      }
    | undefined;
  if (!row) return null;
  const ageDays = (Date.now() - new Date(row.consultado.replace(' ', 'T') + 'Z').getTime()) / 86_400_000;
  if (ageDays > CACHE_TTL_DAYS) return null;
  let actividades: ActividadEconomica[] = [];
  try {
    if (row.actividades_json) actividades = JSON.parse(row.actividades_json) as ActividadEconomica[];
  } catch {
    /* ignore */
  }
  return {
    cedula: row.cedula,
    encontrada: row.estado !== 'no_encontrada',
    nombre: row.nombre,
    tipo_identificacion: row.tipo_identificacion,
    estado: row.estado,
    motivo_estado: row.motivo_estado,
    actividad_economica: row.actividad_economica,
    actividades,
  };
}

function writeCedulaCache(c: Cedula): void {
  const db = getDb();
  db.prepare(
    `INSERT OR REPLACE INTO cedulas_cache
       (cedula, tipo_identificacion, nombre, estado, motivo_estado,
        actividad_economica, actividades_json, consultado)
     VALUES (?, ?, ?, ?, ?, ?, ?, datetime('now'))`,
  ).run(
    c.cedula,
    c.tipo_identificacion,
    c.nombre,
    c.estado,
    c.motivo_estado,
    c.actividad_economica,
    JSON.stringify(c.actividades ?? []),
  );
}

function mapEstadoFromHacienda(estadoStr: string | undefined): EstadoCedula {
  if (!estadoStr) return 'inactivo';
  const s = estadoStr.trim();
  if (/^Inscrito$/i.test(s)) return 'inscrito';
  // "Inscrito de Oficio", "No inscrito", "Suspendido", etc.
  return 'inactivo';
}

function pickActividadPrincipal(actividades: ActividadEconomica[]): string | null {
  if (!actividades || actividades.length === 0) return null;
  const principalActiva = actividades.find((a) => a.estado === 'A' && a.tipo === 'P');
  if (principalActiva) return principalActiva.descripcion;
  const cualquieraActiva = actividades.find((a) => a.estado === 'A');
  if (cualquieraActiva) return cualquieraActiva.descripcion;
  return actividades[0]?.descripcion ?? null;
}

export async function validarCedula(cedula: string): Promise<Cedula> {
  const cleaned = cedula.replace(/\D/g, '');
  const cached = readCedulaFromCache(cleaned);
  if (cached) return cached;

  const url = `${config.hacienda.apiUrl}/fe/ae?identificacion=${encodeURIComponent(cleaned)}`;
  const { status, body } = await fetchJsonWithRetry(url);

  if (status === 404) {
    const noEnc: Cedula = {
      cedula: cleaned,
      encontrada: false,
      nombre: null,
      tipo_identificacion: null,
      estado: 'no_encontrada',
      motivo_estado: 'Cédula no encontrada en el padrón',
      actividad_economica: null,
      actividades: [],
    };
    writeCedulaCache(noEnc);
    return noEnc;
  }

  if (status !== 200 || !body) {
    throw new HaciendaError(`Hacienda devolvió status ${status} al validar cédula ${cleaned}`, {
      status,
      body,
    });
  }

  const r = body as HaciendaPadronResp;
  const estado = mapEstadoFromHacienda(r.situacion?.estado);
  const motivo =
    estado === 'inactivo'
      ? r.situacion?.mensaje ?? `Estado en Hacienda: ${r.situacion?.estado ?? 'desconocido'}`
      : null;
  const actividades = r.actividades ?? [];
  const ced: Cedula = {
    cedula: cleaned,
    encontrada: true,
    nombre: r.nombre ?? null,
    tipo_identificacion: r.tipoIdentificacion ?? null,
    estado,
    motivo_estado: motivo,
    actividad_economica: pickActividadPrincipal(actividades),
    actividades,
  };
  writeCedulaCache(ced);
  return ced;
}

// ============================================================
// CABYS
// ============================================================

export interface CabysResultado {
  encontrado: boolean;
  raw: unknown;
}

export async function consultarCabys(args: {
  codigo?: string;
  q?: string;
}): Promise<CabysResultado> {
  const params: string[] = [];
  if (args.codigo) params.push(`codigo=${encodeURIComponent(args.codigo)}`);
  if (args.q) params.push(`q=${encodeURIComponent(args.q)}`);
  if (params.length === 0) {
    throw new HaciendaError('consultarCabys requiere `codigo` o `q`');
  }
  const url = `${config.hacienda.apiUrl}/fe/cabys?${params.join('&')}`;
  const { status, body } = await fetchJsonWithRetry(url);
  if (status === 404) {
    return { encontrado: false, raw: body };
  }
  if (status !== 200) {
    throw new HaciendaError(`Hacienda /fe/cabys devolvió status ${status}`, { status, body });
  }
  return { encontrado: true, raw: body };
}
