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
import { registrarProcesamiento } from '../lib/fwd-db.js';
import { requireAuth, resolveEmpresaId } from '../lib/auth.js';
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

// Acepta indistintamente:
//   - `file`: un único archivo (compat con clientes viejos / n8n)
//   - `files[]` o `files`: múltiples archivos (P01: "seleccionar carpeta")
const uploadAny = upload.fields([
  { name: 'file', maxCount: 1 },
  { name: 'files', maxCount: 50 },
]);

const BodySchema = z.object({
  empresa_id: z.string().min(1, 'empresa_id requerido'),
});

export const processDocumentRouter = Router();

interface ProcesadoUnitario {
  factura: FacturaSchemaJson;
  resumen: ResumenTaxIva;
  sheet?: { sheet_id: string | null; filas: { reintegro: number; detalle: number }; revision: boolean };
}

interface DocFiles {
  file?: Express.Multer.File[];
  files?: Express.Multer.File[];
}

processDocumentRouter.post('/process-document', requireAuth, uploadAny, async (req, res, next) => {
  const log = logger.child({ reqId: randomUUID().slice(0, 8) });
  // Recolectamos los paths de los uploads para borrarlos en finally —
  // sin esto la carpeta data/uploads/ crece para siempre.
  const tempPathsToCleanup: string[] = [];
  try {
    const docFiles = (req.files ?? {}) as DocFiles;
    const incoming: Express.Multer.File[] = [
      ...(docFiles.file ?? []),
      ...(docFiles.files ?? []),
    ];
    for (const f of incoming) tempPathsToCleanup.push(f.path);
    if (incoming.length === 0) {
      throw new ArchivoInvalidoError(
        'Falta `file` (un PDF/XML) o `files[]` (varios). Subí al menos un documento.',
      );
    }
    // El contador (rol) toma empresa_id de su token; admin puede pasarlo en el body.
    const empresaResuelta = resolveEmpresaId(req);
    const parsed = BodySchema.safeParse(req.body);
    const empresaId = empresaResuelta ?? (parsed.success ? parsed.data.empresa_id : null);
    if (!empresaId) {
      throw new ArchivoInvalidoError('Falta `empresa_id` (o el usuario no tiene empresa asignada en el token).');
    }

    const empresa = getDb()
      .prepare('SELECT id FROM empresas WHERE id = ?')
      .get(empresaId) as { id: string } | undefined;
    if (!empresa) throw new EmpresaDesconocidaError(empresaId);

    log.info('Procesando batch', { archivos: incoming.length, empresaId });

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

    // Cada archivo subido puede a su vez contener varias facturas (PDF
    // multi-factura). Expandimos primero a una lista plana de "sub-documentos",
    // y procesamos cada uno con su propio try/catch.
    interface SubDoc {
      buffer: Buffer;
      mimeType: string;
      filename: string;
      storagePathSuffix: string;
      sourcePath: string;
    }
    const subDocs: SubDoc[] = [];
    for (const f of incoming) {
      const buffer = fs.readFileSync(f.path);
      const partes = await maybeSplit({ buffer, mimeType: f.mimetype, filename: f.originalname });
      partes.forEach((sub, idx) => {
        subDocs.push({
          buffer: sub,
          mimeType: f.mimetype,
          filename: partes.length > 1 ? `${f.originalname}#${idx + 1}` : f.originalname,
          storagePathSuffix: partes.length > 1 ? `#${idx + 1}` : '',
          sourcePath: f.path,
        });
      });
    }
    log.info('Sub-documentos a procesar', { total: subDocs.length });

    const results: ProcesadoUnitario[] = [];
    const errores: Array<{ indice: number; filename: string; error: string; codigo: string }> = [];

    for (let i = 0; i < subDocs.length; i++) {
      const sub = subDocs[i]!;
      const inicio = Date.now();

      try {
        const factura = await extractFactura({
          buffer: sub.buffer,
          mimeType: sub.mimeType,
          filename: sub.filename,
        });
        const { factura: enriched, resumen } = await enrichFactura({
          factura,
          empresa_id: empresaId,
          storagePath:
            path.relative(config.paths.projectRoot, sub.sourcePath) + sub.storagePathSuffix,
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
            registrarProcesamiento({
              facturaId: resumen.factura_id,
              agente: 'tax-iva',
              evento: 'sheet_write_fallido',
              detalle: { error: (err as Error).message },
              duracionMs: Date.now() - inicio,
            });
          }
        }

        results.push({ factura: enriched, resumen, sheet: sheetResult });
      } catch (err) {
        const codigo = err instanceof AppError ? err.codigo : 'PROCESAMIENTO_FALLIDO';
        const mensaje = err instanceof Error ? err.message : String(err);
        log.error('Sub-factura falló — el batch continúa', {
          indice: i + 1,
          total: subDocs.length,
          filename: sub.filename,
          codigo,
          err: mensaje,
        });
        errores.push({ indice: i + 1, filename: sub.filename, codigo, error: mensaje });

        registrarProcesamiento({
          facturaId: null,
          agente: 'docscan',
          evento: 'sub_factura_fallida',
          detalle: {
            indice: i + 1,
            total: subDocs.length,
            filename: sub.filename,
            codigo,
            error: mensaje.slice(0, 500),
          },
          duracionMs: Date.now() - inicio,
        });
      }
    }

    // Si fue un solo sub-documento Y un solo archivo subido, mantenemos el
    // shape clásico de respuesta para no romper clientes existentes (n8n, tests).
    const wasSingleUpload =
      incoming.length === 1 && subDocs.length === 1 && (docFiles.files?.length ?? 0) === 0;
    if (wasSingleUpload) {
      if (results.length === 1) {
        const r = results[0]!;
        res.status(200).json({ factura: r.factura, resumen: r.resumen, sheet: r.sheet ?? null });
        return;
      }
      const e = errores[0]!;
      res.status(422).json({
        error: 'No se pudo procesar el documento.',
        codigo: e.codigo,
        detalle: e.error,
      });
      return;
    }

    // Batch: respondemos con éxitos + errores. El frontend muestra ambos.
    res.status(200).json({
      multi: true,
      total: subDocs.length,
      archivos_subidos: incoming.length,
      procesadas: results.length,
      fallidas: errores.length,
      resultados: results,
      errores,
    });
  } catch (err) {
    if (err instanceof AppError) {
      next(err);
      return;
    }
    log.error('Error inesperado procesando documento', { err: (err as Error).message });
    next(err);
  } finally {
    // Cleanup de uploads temporales. Best effort — si falla la borrada
    // (archivo ya borrado, permisos), seguimos sin tirar. El paso para el
    // cliente HTTP ya respondió o falló para entonces.
    for (const p of tempPathsToCleanup) {
      fs.promises.unlink(p).catch(() => {
        /* archivo ya no estaba, ok */
      });
    }
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
