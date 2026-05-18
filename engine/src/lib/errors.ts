/**
 * Errores tipados del motor.
 *
 * Cada error lleva:
 *  - `codigo`: identificador estable (UPPER_SNAKE) para que el cliente discrimine sin parsear texto.
 *  - `message` en español de CR, dirigido al contador.
 *  - `httpStatus` para mapeo directo en el middleware de Express.
 *  - `detalle` opcional con info técnica.
 */
export class AppError extends Error {
  public readonly codigo: string;
  public readonly httpStatus: number;
  public readonly detalle: unknown;

  constructor(codigo: string, message: string, httpStatus = 500, detalle?: unknown) {
    super(message);
    this.name = this.constructor.name;
    this.codigo = codigo;
    this.httpStatus = httpStatus;
    this.detalle = detalle;
  }
}

export class FacturaInvalidaError extends AppError {
  constructor(message: string, detalle?: unknown) {
    super('FACTURA_INVALIDA', message, 422, detalle);
  }
}

export class ReconciliacionFallidaError extends AppError {
  constructor(message: string, detalle?: unknown) {
    super('RECONCILIACION_FALLIDA', message, 422, detalle);
  }
}

export class EmpresaDesconocidaError extends AppError {
  constructor(empresaId: string) {
    super(
      'EMPRESA_DESCONOCIDA',
      `La empresa con cédula ${empresaId} no está registrada en el sistema.`,
      404,
      { empresa_id: empresaId },
    );
  }
}

export class FacturaOtraEmpresaError extends AppError {
  constructor(receptor: string, empresa: string) {
    super(
      'FACTURA_OTRA_EMPRESA',
      `Esta factura es para el receptor ${receptor}, pero estás procesando libros de ${empresa}.`,
      422,
      { receptor, empresa },
    );
  }
}

export class AgenteFalloError extends AppError {
  constructor(agente: string, message: string, detalle?: unknown) {
    super('AGENTE_FALLO', `El agente ${agente} no pudo completar la tarea: ${message}`, 500, detalle);
  }
}

export class ArchivoInvalidoError extends AppError {
  constructor(message: string, detalle?: unknown) {
    super('ARCHIVO_INVALIDO', message, 400, detalle);
  }
}
