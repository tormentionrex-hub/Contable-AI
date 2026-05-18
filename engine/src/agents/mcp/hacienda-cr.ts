/**
 * MCP server in-process: expone las herramientas de Hacienda CR al sub-agente Tax-IVA.
 *
 * NO es un proceso separado — usa `createSdkMcpServer` del Agent SDK, que vive en el
 * mismo proceso que el motor. Decisión documentada en docs/FASE-2-REPORTE.md.
 *
 * Comparte código con los endpoints HTTP (engine/src/routes/hacienda.ts) — toda la
 * lógica de cache/retry/fallback vive en engine/src/lib/hacienda.ts.
 */

import { createSdkMcpServer, tool, type McpSdkServerConfigWithInstance } from '@anthropic-ai/claude-agent-sdk';
import { z } from 'zod';
import {
  obtenerTipoCambio,
  tipoCambioActual,
  validarCedula,
  consultarCabys,
  type Moneda,
} from '../../lib/hacienda.js';

const monedaSchema = z.enum(['USD', 'EUR']);
const fechaSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'Formato YYYY-MM-DD requerido')
  .describe('Fecha en formato ISO YYYY-MM-DD. Para "hoy" omitir el campo.');

export function buildHaciendaMcp(): McpSdkServerConfigWithInstance {
  return createSdkMcpServer({
    name: 'hacienda-cr',
    version: '0.2.0',
    tools: [
      tool(
        'obtener_tipo_cambio',
        'Obtiene el tipo de cambio oficial CRC↔(USD|EUR) vigente en una fecha. Si la fecha es un día no hábil, retrocede automáticamente hasta encontrar el último TC publicado.',
        {
          fecha: fechaSchema.optional(),
          moneda: monedaSchema,
        },
        async (args) => {
          const tc = await obtenerTipoCambio({ fecha: args.fecha, moneda: args.moneda as Moneda });
          return { content: [{ type: 'text', text: JSON.stringify(tc) }] };
        },
      ),
      tool(
        'tipo_cambio_actual',
        'Obtiene el tipo de cambio oficial vigente HOY (CRC↔USD o CRC↔EUR). Alias de obtener_tipo_cambio con fecha=hoy.',
        { moneda: monedaSchema },
        async (args) => {
          const tc = await tipoCambioActual(args.moneda as Moneda);
          return { content: [{ type: 'text', text: JSON.stringify(tc) }] };
        },
      ),
      tool(
        'validar_cedula',
        'Valida la cédula de un proveedor contra el padrón oficial de Hacienda CR. Devuelve nombre, estado tributario y actividad económica principal. Si la cédula no existe, devuelve encontrada=false (no tira excepción).',
        { cedula: z.string().min(9).max(15).describe('Cédula sin guiones (9 a 15 dígitos)') },
        async (args) => {
          const ced = await validarCedula(args.cedula);
          return { content: [{ type: 'text', text: JSON.stringify(ced) }] };
        },
      ),
      tool(
        'consultar_cabys',
        'Consulta el Catálogo de Bienes y Servicios (CABYS) de Hacienda CR. Útil para identificar la tarifa de IVA legal de un producto. Aceptá `codigo` (13 dígitos exactos) o `q` (texto libre, mínimo 3 caracteres).',
        {
          codigo: z.string().regex(/^\d{13}$/).optional(),
          q: z.string().min(3).optional(),
        },
        async (args) => {
          const res = await consultarCabys({ codigo: args.codigo, q: args.q });
          return { content: [{ type: 'text', text: JSON.stringify(res) }] };
        },
      ),
    ],
  });
}
