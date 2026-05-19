import Ajv2020, { type ErrorObject, type ValidateFunction } from 'ajv/dist/2020.js';
import addFormats from 'ajv-formats';
import fs from 'node:fs';
import path from 'node:path';
import { config } from '../config.js';
import type { FacturaSchemaJson } from '../types/factura.js';

const schemaPath = path.join(config.paths.schemas, 'factura.schema.json');
const schemaRaw = fs.readFileSync(schemaPath, 'utf8');
const schema = JSON.parse(schemaRaw) as Record<string, unknown>;

const ajv = new Ajv2020({
  allErrors: true,
  strict: false,
  coerceTypes: false,
});
addFormats(ajv);

const _validate: ValidateFunction = ajv.compile(schema);

export interface ValidationResult {
  valid: boolean;
  errors: ErrorObject[] | null;
  errorsText?: string;
}

export function validateFactura(payload: unknown): ValidationResult {
  const valid = _validate(payload);
  if (valid) {
    return { valid: true, errors: null };
  }
  const errors = _validate.errors ?? [];
  return {
    valid: false,
    errors,
    errorsText: errors
      .map((e) => `${e.instancePath || '(root)'} ${e.message ?? 'inválido'} ${JSON.stringify(e.params)}`)
      .join('; '),
  };
}

export function isFacturaSchemaJson(payload: unknown): payload is FacturaSchemaJson {
  return validateFactura(payload).valid;
}

export function getSchema(): Record<string, unknown> {
  return schema;
}
