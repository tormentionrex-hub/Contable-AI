/**
 * MCP server in-process: expone SQL de solo lectura + helpers de auditoría
 * al sub-agente Tax-IVA (y, en Fase 3, al Asistente Contable).
 *
 * Comparte código con los endpoints HTTP — toda la lógica vive en lib/fwd-db.ts.
 */

import { createSdkMcpServer, tool, type McpSdkServerConfigWithInstance } from '@anthropic-ai/claude-agent-sdk';
import { z } from 'zod';
import {
  runSelect,
  describeSchema,
  registrarProcesamiento,
} from '../../lib/fwd-db.js';

export function buildFwdDbMcp(): McpSdkServerConfigWithInstance {
  return createSdkMcpServer({
    name: 'fwd-db',
    version: '0.2.0',
    tools: [
      tool(
        'query',
        'Ejecuta una consulta SQL de SOLO LECTURA contra la base de datos del proyecto. Únicamente SELECT (o WITH ... SELECT) están permitidos. Devuelve { filas, cantidad }. Cualquier intento de INSERT/UPDATE/DELETE/DDL tira error.',
        {
          sql: z
            .string()
            .min(7)
            .describe('Sentencia SELECT completa. Ejemplo: SELECT * FROM facturas WHERE empresa_id = ?'),
        },
        async (args) => {
          const res = runSelect(args.sql);
          return { content: [{ type: 'text', text: JSON.stringify(res) }] };
        },
      ),
      tool(
        'describe_schema',
        'Devuelve la estructura completa de tablas y vistas de la base (nombre, columnas, tipos, PK, NOT NULL). Usalo cuando dudes contra qué columna consultar.',
        {},
        async () => {
          const schema = describeSchema();
          return { content: [{ type: 'text', text: JSON.stringify(schema) }] };
        },
      ),
      tool(
        'registrar_procesamiento',
        'Registra un evento de auditoría en la tabla procesamientos. Útil para dejar traza de las decisiones del agente (ej: "reconciliación OK con tolerancia ±₡1").',
        {
          factura_id: z.string().nullable().optional(),
          agente: z.enum(['docscan', 'tax-iva', 'asistente']),
          evento: z.string(),
          detalle: z.any().optional(),
          duracion_ms: z.number().int().optional(),
        },
        async (args) => {
          registrarProcesamiento({
            facturaId: args.factura_id ?? undefined,
            agente: args.agente,
            evento: args.evento,
            detalle: args.detalle,
            duracionMs: args.duracion_ms,
          });
          return { content: [{ type: 'text', text: JSON.stringify({ ok: true }) }] };
        },
      ),
    ],
  });
}
