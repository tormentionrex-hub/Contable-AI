import { config as loadDotenv } from 'dotenv';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { z } from 'zod';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Carga .env desde la raíz del paquete engine/
loadDotenv({ path: path.resolve(__dirname, '..', '.env') });

const Schema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().positive().default(3000),
  CLAUDE_AUTH_MODE: z.enum(['claude_code', 'api_key']).default('claude_code'),
  CLAUDE_MODEL: z.string().optional(),
  CLAUDE_CODE_EXECUTABLE: z.string().optional(),
  ANTHROPIC_API_KEY: z.string().optional(),
  DB_PATH: z.string().default('./data/fwd-contable.db'),
  STORAGE_PATH: z.string().default('./data/storage'),
  UPLOAD_PATH: z.string().default('./data/uploads'),
  LOG_LEVEL: z.enum(['error', 'warn', 'info', 'debug']).default('info'),
});

const parsed = Schema.safeParse(process.env);
if (!parsed.success) {
  // En boot, fallar duro con error humano.
  // eslint-disable-next-line no-console
  console.error('Configuración inválida:', parsed.error.flatten().fieldErrors);
  process.exit(1);
}

const env = parsed.data;

const projectRoot = path.resolve(__dirname, '..');

function resolveFromRoot(p: string): string {
  return path.isAbsolute(p) ? p : path.resolve(projectRoot, p);
}

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
  paths: {
    projectRoot,
    db: resolveFromRoot(env.DB_PATH),
    storage: resolveFromRoot(env.STORAGE_PATH),
    uploads: resolveFromRoot(env.UPLOAD_PATH),
    skills: path.resolve(projectRoot, 'skills'),
    schemas: path.resolve(projectRoot, 'schemas'),
    fixtures: path.resolve(projectRoot, 'tests', 'fixtures'),
  },
  logLevel: env.LOG_LEVEL,
  version: '0.1.0',
} as const;

export type AppConfig = typeof config;
