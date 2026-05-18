import fs from 'node:fs';
import path from 'node:path';
import {
  query,
  type SDKMessage,
  type SDKResultMessage,
  type McpSdkServerConfigWithInstance,
} from '@anthropic-ai/claude-agent-sdk';
import { config } from '../config.js';
import { logger } from '../lib/logger.js';
import { AgenteFalloError } from '../lib/errors.js';

export interface SubagentDefinition {
  name: string;
  skillPath: string;
  /**
   * Servidores MCP in-process disponibles para este sub-agente.
   * Las herramientas expuestas se nombran como `mcp__<server>__<tool>` y deben
   * incluirse en `allowedTools` para que el agente pueda invocarlas.
   */
  mcpServers?: Record<string, McpSdkServerConfigWithInstance>;
}

export interface RunOptions {
  /** Prompt textual del usuario al sub-agente. */
  prompt: string;
  /** JSON Schema para forzar salida estructurada (opcional). */
  outputSchema?: Record<string, unknown>;
  /** Modelo a forzar (opcional; usa config.claude.model si no se da). */
  model?: string;
  /** Máximo de turnos (default 3 — uno suele bastar). */
  maxTurns?: number;
  /**
   * Override de MCP servers para esta corrida (sobrescribe los de la definición).
   * Útil en tests para inyectar mocks.
   */
  mcpServers?: Record<string, McpSdkServerConfigWithInstance>;
  /**
   * Built-in tools del Agent SDK habilitados ADEMÁS de los MCPs.
   * Ejemplo: `['Read']` cuando el agente necesita leer un PDF escaneado del disco.
   */
  builtinTools?: string[];
  /**
   * Directorios que el agente puede leer (cuando builtinTools incluye Read).
   * Por defecto, el cwd del proceso.
   */
  additionalDirectories?: string[];
}

export interface RunResult<T = unknown> {
  output: T;
  rawText: string;
  durationMs: number;
  costUsd: number;
}

export interface Subagent {
  name: string;
  systemPrompt: string;
  run<T = unknown>(opts: RunOptions): Promise<RunResult<T>>;
}

function readSkillSystemPrompt(skillPath: string): string {
  if (!fs.existsSync(skillPath)) {
    throw new Error(`Skill no encontrado en ${skillPath}`);
  }
  const raw = fs.readFileSync(skillPath, 'utf8');
  // Stripear frontmatter YAML (--- ... ---) si está presente.
  const stripped = raw.replace(/^---[\s\S]*?---\s*\n/, '');
  return stripped.trim();
}

/**
 * Extrae el primer bloque JSON del texto de respuesta.
 * Útil cuando `structured_output` no llega (el modelo respondió en texto libre).
 */
function extractJsonFromText(text: string): unknown {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  const candidate = (fenced?.[1] ?? text).trim();
  // Buscar el primer { ... } balanceado.
  const start = candidate.indexOf('{');
  if (start === -1) {
    throw new Error('El sub-agente no devolvió JSON');
  }
  let depth = 0;
  let inString = false;
  let escape = false;
  for (let i = start; i < candidate.length; i++) {
    const ch = candidate[i];
    if (escape) {
      escape = false;
      continue;
    }
    if (ch === '\\') {
      escape = true;
      continue;
    }
    if (ch === '"') {
      inString = !inString;
      continue;
    }
    if (inString) continue;
    if (ch === '{') depth++;
    if (ch === '}') {
      depth--;
      if (depth === 0) {
        const json = candidate.slice(start, i + 1);
        return JSON.parse(json);
      }
    }
  }
  throw new Error('JSON sin cerrar en la respuesta del sub-agente');
}

export function createSubagent(def: SubagentDefinition): Subagent {
  const systemPrompt = readSkillSystemPrompt(def.skillPath);
  const log = logger.child({ agente: def.name });

  return {
    name: def.name,
    systemPrompt,
    async run<T = unknown>(opts: RunOptions): Promise<RunResult<T>> {
      const model = opts.model ?? config.claude.model;
      const start = Date.now();

      // El SDK lanza el binario `claude` del usuario (Claude Code Max plan).
      // No pasamos ANTHROPIC_API_KEY: la autenticación viene de la sesión local.

      // Resolver MCPs: opts.mcpServers tiene prioridad (útil para tests).
      const mcpServers = opts.mcpServers ?? def.mcpServers ?? {};
      // Construir allowedTools: cada MCP expone N tools como `mcp__<server>__<tool>`.
      // El SDK las descubre dinámicamente; les damos permisos via wildcard del server.
      const builtin = opts.builtinTools ?? [];
      const allowedTools = [...builtin, ...Object.keys(mcpServers).map((server) => `mcp__${server}`)];

      const q = query({
        prompt: opts.prompt,
        options: {
          systemPrompt,
          model,
          // Por default sin built-in tools (aislado). El sub-agente solo accede
          // a los MCPs in-process pasados arriba.
          // Si builtinTools incluye herramientas (ej: ['Read']), las habilitamos.
          tools: builtin.length > 0 ? builtin : [],
          mcpServers,
          allowedTools,
          ...(opts.additionalDirectories && opts.additionalDirectories.length > 0
            ? { additionalDirectories: opts.additionalDirectories }
            : {}),
          // Aislado de settings de usuario — no carga CLAUDE.md ajenos.
          settingSources: [],
          // Sin persistencia de sesión: cada llamada es one-shot.
          persistSession: false,
          maxTurns: opts.maxTurns ?? 5,
          permissionMode: 'bypassPermissions',
          allowDangerouslySkipPermissions: true,
          ...(opts.outputSchema
            ? { outputFormat: { type: 'json_schema' as const, schema: opts.outputSchema } }
            : {}),
          ...(config.claude.pathToClaudeCodeExecutable
            ? { pathToClaudeCodeExecutable: config.claude.pathToClaudeCodeExecutable }
            : {}),
          stderr: (data: string) => log.debug('claude-stderr', { data: data.slice(0, 500) }),
        },
      });

      let resultMsg: SDKResultMessage | null = null;
      for await (const msg of q as AsyncGenerator<SDKMessage, void>) {
        if (msg.type === 'result') {
          resultMsg = msg;
        }
      }

      const durationMs = Date.now() - start;

      if (!resultMsg) {
        throw new AgenteFalloError(def.name, 'No se recibió mensaje de resultado del SDK');
      }
      if (resultMsg.subtype !== 'success') {
        throw new AgenteFalloError(def.name, `Falló (${resultMsg.subtype})`, {
          subtype: resultMsg.subtype,
          errors: 'errors' in resultMsg ? resultMsg.errors : undefined,
        });
      }

      const rawText = resultMsg.result ?? '';
      let output: unknown;
      if (resultMsg.structured_output !== undefined && resultMsg.structured_output !== null) {
        output = resultMsg.structured_output;
      } else {
        try {
          output = extractJsonFromText(rawText);
        } catch (err) {
          throw new AgenteFalloError(def.name, 'La respuesta no contiene JSON parseable', {
            rawText: rawText.slice(0, 500),
            err: (err as Error).message,
          });
        }
      }

      log.info('Agente OK', {
        durationMs,
        costUsd: resultMsg.total_cost_usd,
        turns: resultMsg.num_turns,
      });

      return {
        output: output as T,
        rawText,
        durationMs,
        costUsd: resultMsg.total_cost_usd ?? 0,
      };
    },
  };
}

export function defaultSkillPath(skillFile: string): string {
  return path.join(config.paths.skills, skillFile);
}
