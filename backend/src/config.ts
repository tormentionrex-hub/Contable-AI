import { config as loadDotenv } from 'dotenv';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { z } from 'zod';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Carga .env desde la raíz del paquete engine/
loadDotenv({ path: path.resolve(__dirname, '..', '.env') });

const Schema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().positive().default(3000),

  // Claude Agent SDK
  CLAUDE_AUTH_MODE: z.enum(['claude_code', 'api_key']).default('claude_code'),
  CLAUDE_MODEL: z.string().optional(),
  CLAUDE_CODE_EXECUTABLE: z.string().optional(),
  ANTHROPIC_API_KEY: z.string().optional(),

  // Persistencia local
  DB_PATH: z.string().default('./data/fwd-contable.db'),
  STORAGE_PATH: z.string().default('./data/storage'),
  UPLOAD_PATH: z.string().default('./data/uploads'),
  LOG_LEVEL: z.enum(['error', 'warn', 'info', 'debug']).default('info'),

  // Hacienda CR (público, sin auth)
  HACIENDA_API_URL: z.string().url().default('https://api.hacienda.go.cr'),
  HACIENDA_TC_FALLBACK_FAWAZ: z
    .string()
    .url()
    .default('https://cdn.jsdelivr.net/npm/@fawazahmed0/currency-api@latest/v1/currencies/usd.json'),
  HACIENDA_TC_FALLBACK_FRANKFURTER: z
    .string()
    .url()
    .default('https://api.frankfurter.dev/v1/latest?from=USD&to=CRC'),

  // Google Sheets
  GOOGLE_SERVICE_ACCOUNT_JSON: z.string().optional(),
  GOOGLE_SHEET_ID_FUNDACION_CRC: z.string().optional(),
  CONTADOR_EMAIL: z.string().email().optional().or(z.literal('')),

  // Deprecated (heredadas de Fase 1, NO usar)
  BCCR_NOMBRE: z.string().optional(),
  BCCR_EMAIL: z.string().optional(),
  BCCR_TOKEN: z.string().optional(),
  HACIENDA_PADRON_URL: z.string().optional(),
  HACIENDA_FE_API_URL: z.string().optional(),
  HACIENDA_FE_USER: z.string().optional(),
  HACIENDA_FE_PASS: z.string().optional(),
  GOOGLE_SHEET_ID: z.string().optional(),
});

const parsed = Schema.safeParse(process.env);
if (!parsed.success) {
  // eslint-disable-next-line no-console
  console.error('Configuración inválida:', parsed.error.flatten().fieldErrors);
  process.exit(1);
}

const env = parsed.data;

const projectRoot = path.resolve(__dirname, '..');
const workspaceRoot = path.resolve(projectRoot, '..');

function resolveFromRoot(p: string): string {
  return path.isAbsolute(p) ? p : path.resolve(projectRoot, p);
}

/**
 * El usuario configuró el path del JSON como relativo a la raíz del workspace
 * (donde vive `credentials/`), no a `engine/`. Probamos en este orden:
 *   1) ruta absoluta tal cual
 *   2) relativo a engine/
 *   3) relativo a la raíz del workspace
 * Si no se encuentra, dejamos undefined y log warning (Sheets quedará deshabilitado).
 */
function resolveServiceAccountPath(raw: string | undefined): string | undefined {
  if (!raw || raw.trim().length === 0) return undefined;
  const candidates = path.isAbsolute(raw)
    ? [raw]
    : [path.resolve(projectRoot, raw), path.resolve(workspaceRoot, raw)];
  for (const c of candidates) {
    if (fs.existsSync(c)) return c;
  }
  // No fatal: avisamos por stderr y devolvemos undefined.
  // eslint-disable-next-line no-console
  console.warn(
    `[config] GOOGLE_SERVICE_ACCOUNT_JSON no encontrado. Probé:\n` +
      candidates.map((c) => `  - ${c}`).join('\n') +
      `\nSheets quedará deshabilitado hasta que se genere el JSON.`,
  );
  return undefined;
}

const serviceAccountJsonPath = resolveServiceAccountPath(env.GOOGLE_SERVICE_ACCOUNT_JSON);

export const config = {
  nodeEnv: env.NODE_ENV,
  isProd: env.NODE_ENV === 'production',
  isTest: env.NODE_ENV === 'test',
  port: env.PORT,

  claude: {
    authMode: env.CLAUDE_AUTH_MODE,
    model: env.CLAUDE_MODEL && env.CLAUDE_MODEL.trim().length > 0 ? env.CLAUDE_MODEL : undefined,
    pathToClaudeCodeExecutable: env.CLAUDE_CODE_EXECUTABLE,
    apiKey: env.ANTHROPIC_API_KEY,
  },

  hacienda: {
    apiUrl: env.HACIENDA_API_URL.replace(/\/+$/, ''),
    fallbacks: {
      fawaz: env.HACIENDA_TC_FALLBACK_FAWAZ,
      frankfurterUsd: env.HACIENDA_TC_FALLBACK_FRANKFURTER,
      // Frankfurter no permite definir base+target en var única, usamos uno fijo para EUR.
      frankfurterEur: 'https://api.frankfurter.dev/v1/latest?from=EUR&to=CRC',
    },
  },

  google: {
    serviceAccountJsonPath,
    sheetIdFundacionCrc:
      env.GOOGLE_SHEET_ID_FUNDACION_CRC && env.GOOGLE_SHEET_ID_FUNDACION_CRC.trim().length > 0
        ? env.GOOGLE_SHEET_ID_FUNDACION_CRC
        : undefined,
    contadorEmail:
      env.CONTADOR_EMAIL && env.CONTADOR_EMAIL.trim().length > 0 ? env.CONTADOR_EMAIL : undefined,
  },

  paths: {
    projectRoot,
    db: resolveFromRoot(env.DB_PATH),
    storage: resolveFromRoot(env.STORAGE_PATH),
    uploads: resolveFromRoot(env.UPLOAD_PATH),
    skills: path.resolve(projectRoot, 'skills'),
    schemas: path.resolve(projectRoot, 'schemas'),
    fixtures: path.resolve(projectRoot, 'tests', 'fixtures'),
    envFile: path.resolve(projectRoot, '.env'),
  },

  logLevel: env.LOG_LEVEL,
  version: '0.2.0',
} as const;

export type AppConfig = typeof config;
