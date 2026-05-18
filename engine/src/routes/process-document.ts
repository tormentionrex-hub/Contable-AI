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
  limits: { fileSize: 10 * 1024 * 1024 }, // 10 MB
});

const BodySchema = z.object({
  empresa_id: z.string().min(1, 'empresa_id requerido'),
});

export const processDocumentRouter = Router();

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

    const factura = await extractFactura({ buffer, mimeType, filename });
    const { factura: enriched, resumen } = await enrichFactura({
      factura,
      empresa_id: empresaId,
      storagePath: path.relative(config.paths.projectRoot, req.file.path),
    });

    res.status(200).json({ factura: enriched, resumen });
  } catch (err) {
    if (err instanceof AppError) {
      next(err);
      return;
    }
    log.error('Error inesperado procesando documento', { err: (err as Error).message });
    next(err);
  }
});
