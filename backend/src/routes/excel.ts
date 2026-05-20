/**
 * Endpoints de descarga de reportes Excel.
 *
 *   GET /excel/reintegro?empresa_id=...&mes=YYYY-MM&saldo=1
 *   GET /excel/tax-iva?empresa_id=...&mes=YYYY-MM
 *
 * Devuelven el archivo .xlsx generado a partir de la DB local.
 * No requieren credenciales de Google: corren contra SQLite local.
 */

import { Router } from 'express';
import { z } from 'zod';
import {
  generarExcelReintegroCajaChica,
  generarExcelTaxIva,
  generarExcelRespaldoCompleto,
} from '../lib/excel.js';
import { requireAuth, resolveEmpresaId } from '../lib/auth.js';
import { AppError } from '../lib/errors.js';
import { logger } from '../lib/logger.js';

const log = logger.child({ mod: 'excel-routes' });

export const excelRouter = Router();

const Query = z.object({
  empresa_id: z.string().min(1).optional(),
  mes: z.string().regex(/^\d{4}-\d{2}$/).optional(),
  desde: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  hasta: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  saldo: z.string().optional(),
});

excelRouter.get('/excel/reintegro', requireAuth, async (req, res, next) => {
  try {
    const parsed = Query.safeParse(req.query);
    if (!parsed.success) {
      throw new AppError(
        'QUERY_INVALIDA',
        'Query inválida',
        400,
        parsed.error.flatten().fieldErrors,
      );
    }
    const empresa_id = resolveEmpresaId(req) ?? parsed.data.empresa_id ?? null;
    if (!empresa_id) {
      throw new AppError('EMPRESA_REQUERIDA', 'Falta empresa_id', 400);
    }
    const incluirSaldo = parsed.data.saldo === '1' || parsed.data.saldo === 'true';

    const { buffer, filename, totalCrc, saldoLiquido } = await generarExcelReintegroCajaChica({
      empresa_id,
      mes: parsed.data.mes,
      desde: parsed.data.desde,
      hasta: parsed.data.hasta,
      incluirSaldoCajaChica: incluirSaldo,
    });

    log.info('Excel Reintegro generado', { empresa_id, totalCrc, saldoLiquido, bytes: buffer.length });

    res.setHeader(
      'Content-Type',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    );
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.setHeader('X-Total-Crc', String(totalCrc));
    if (saldoLiquido !== null) res.setHeader('X-Saldo-Liquido', String(saldoLiquido));
    res.send(buffer);
  } catch (err) {
    if (err instanceof AppError) return next(err);
    log.error('Falló generación de Excel Reintegro', { err: (err as Error).message });
    next(err);
  }
});

excelRouter.get('/excel/respaldo', requireAuth, async (req, res, next) => {
  try {
    const parsed = Query.safeParse(req.query);
    if (!parsed.success) {
      throw new AppError('QUERY_INVALIDA', 'Query inválida', 400, parsed.error.flatten().fieldErrors);
    }
    const empresa_id = resolveEmpresaId(req) ?? parsed.data.empresa_id ?? null;
    if (!empresa_id) {
      throw new AppError('EMPRESA_REQUERIDA', 'Falta empresa_id', 400);
    }
    const { buffer, filename, total_facturas, total_crc } = await generarExcelRespaldoCompleto({
      empresa_id,
      mes: parsed.data.mes,
      desde: parsed.data.desde,
      hasta: parsed.data.hasta,
    });
    log.info('Excel Respaldo generado', { empresa_id, total_facturas, total_crc, bytes: buffer.length });
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.setHeader('X-Total-Facturas', String(total_facturas));
    res.setHeader('X-Total-Crc', String(total_crc));
    res.send(buffer);
  } catch (err) {
    if (err instanceof AppError) return next(err);
    log.error('Falló generación de Excel Respaldo', { err: (err as Error).message });
    next(err);
  }
});

excelRouter.get('/excel/tax-iva', requireAuth, async (req, res, next) => {
  try {
    const parsed = Query.safeParse(req.query);
    if (!parsed.success) {
      throw new AppError(
        'QUERY_INVALIDA',
        'Query inválida',
        400,
        parsed.error.flatten().fieldErrors,
      );
    }
    const empresa_id = resolveEmpresaId(req) ?? parsed.data.empresa_id ?? null;
    if (!empresa_id) {
      throw new AppError('EMPRESA_REQUERIDA', 'Falta empresa_id', 400);
    }

    const { buffer, filename, totalCrc, totalIvaCrc } = await generarExcelTaxIva({
      empresa_id,
      mes: parsed.data.mes,
      desde: parsed.data.desde,
      hasta: parsed.data.hasta,
    });

    log.info('Excel Tax-IVA generado', { empresa_id, totalCrc, totalIvaCrc, bytes: buffer.length });

    res.setHeader(
      'Content-Type',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    );
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.setHeader('X-Total-Crc', String(totalCrc));
    res.setHeader('X-Total-Iva-Crc', String(totalIvaCrc));
    res.send(buffer);
  } catch (err) {
    if (err instanceof AppError) return next(err);
    log.error('Falló generación de Excel Tax-IVA', { err: (err as Error).message });
    next(err);
  }
});
