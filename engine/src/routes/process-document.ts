import { Router } from 'express';
import multer from 'multer';
import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { config } from '../config.js';
import { logger } from '../lib/logger.js';
import { extractFactura } from '../agents/docscan.js';
import { enrichFactura } from '../agents/tax-iva.js';
import { AppError, ArchivoInvalidoError, EmpresaDesconocidaError } from '../lib/errors.js';
import { getDb } from '../lib/db.js';
import { splitMultiInvoicePdf, SplitterError } from '../lib/pdf-split.js';
import {
  appendFactura,
  markRevision,
  ensureSheetForEmpresa,
  isSheetsEnabled,
  SheetsError,
} from '../lib/sheets.js';
import type { FacturaSchemaJson, ResumenTaxIva } from '../types/factura.js';

const uploadDir = config.paths.uploads;
if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir, { recursive: true });

const upload = multer({
  storage: multer.diskStorage({
    destination: uploadDir,
    filename: (_req, file, cb) => {
      const safe = file.originalname.replace(/[^\w.\-]/g, '_');
      cb(null, `${Date.now()}-${randomUUID().slice(0, 8)}-${safe}`);
    },
  }),
  limits: { fileSize: 20 * 1024 * 1024 }, // 20 MB (Caja Chica son 1.8 MB; subimos margen)
});

const BodySchema = z.object({
  empresa_id: z.string().min(1, 'empresa_id requerido'),
});

export const processDocumentRouter = Router();

interface ProcesadoUnitario {
  factura: FacturaSchemaJson;
  resumen: ResumenTaxIva;
  sheet?: { sheet_id: string | null; filas: { reintegro: number; detalle: number }; revision: boolean };
}

processDocumentRouter.post('/process-document', upload.single('file'), async (req, res, next) => {
  const log = logger.child({ reqId: randomUUID().slice(0, 8) });
  try {
    if (!req.file) {
      throw new ArchivoInvalidoError('Falta el campo `file` con el PDF o XML.');
    }
    const parsed = BodySchema.safeParse(req.body);
    if (!parsed.success) {
      throw new ArchivoInvalidoError('Body inválido', parsed.error.flatten().fieldErrors);
    }
    const empresaId = parsed.data.empresa_id;

    const empresa = getDb()
      .prepare('SELECT id FROM empresas WHERE id = ?')
      .get(empresaId) as { id: string } | undefined;
    if (!empresa) throw new EmpresaDesconocidaError(empresaId);

    const buffer = fs.readFileSync(req.file.path);
    const filename = req.file.originalname;
    const mimeType = req.file.mimetype;

    log.info('Procesando documento', { filename, mimeType, empresaId, sizeKb: Math.round(buffer.length / 1024) });

    // Bootstrap: si la empresa no tiene Sheet, lo creamos (solo si Sheets está habilitado).
    let sheetId: string | null = null;
    if (isSheetsEnabled()) {
      try {
        sheetId = await ensureSheetForEmpresa(empresaId);
      } catch (err) {
        log.warn('No se pudo asegurar Sheet de la empresa; sigo solo con DB', {
          err: (err as Error).message,
        });
      }
    }

    // Splitter: si es PDF, probamos separar multi-factura.
    const buffers = await maybeSplit({ buffer, mimeType, filename });
    log.info('Documento separado', { partes: buffers.length });

    const results: ProcesadoUnitario[] = [];
    for (let i = 0; i < buffers.length; i++) {
      const sub = buffers[i]!;
      const subFilename = buffers.length > 1 ? `${filename}#${i + 1}` : filename;
      const factura = await extractFactura({ buffer: sub, mimeType, filename: subFilename });
      const { factura: enriched, resumen } = await enrichFactura({
        factura,
        empresa_id: empresaId,
        storagePath: path.relative(config.paths.projectRoot, req.file.path) + (buffers.length > 1 ? `#${i + 1}` : ''),
      });

      let sheetResult: ProcesadoUnitario['sheet'] = undefined;
      if (sheetId && isSheetsEnabled()) {
        try {
          const appended = await appendFactura({ sheetId, factura: enriched });
          if (enriched.requiere_revision_humana) {
            await markRevision({ sheetId, factura: enriched });
          }
          sheetResult = {
            sheet_id: sheetId,
            filas: appended.filas,
            revision: enriched.requiere_revision_humana,
          };
        } catch (err) {
          log.error('Error escribiendo a Sheets; sigo con DB', { err: (err as Error).message });
          sheetResult = { sheet_id: sheetId, filas: { reintegro: 0, detalle: 0 }, revision: false };
        }
      }

      results.push({ factura: enriched, resumen, sheet: sheetResult });
    }

    // Si fue un solo documento, respondemos en el shape clásico de Fase 1.
    if (results.length === 1) {
      const r = results[0]!;
      res.status(200).json({
        factura: r.factura,
        resumen: r.resumen,
        sheet: r.sheet ?? null,
      });
      return;
    }

    // Multi-factura: respondemos un array.
    res.status(200).json({
      multi: true,
      total: results.length,
      resultados: results,
    });
  } catch (err) {
    if (err instanceof AppError) {
      next(err);
      return;
    }
    log.error('Error inesperado procesando documento', { err: (err as Error).message });
    next(err);
  }
});

async function maybeSplit(input: { buffer: Buffer; mimeType: string; filename: string }): Promise<Buffer[]> {
  if (input.mimeType !== 'application/pdf' && !input.filename.toLowerCase().endsWith('.pdf')) {
    return [input.buffer];
  }
  try {
    return await splitMultiInvoicePdf(input.buffer);
  } catch (err) {
    if (err instanceof SplitterError) {
      logger.warn('Splitter falló; procesando como documento único', { err: err.message });
      return [input.buffer];
    }
    throw err;
  }
}
