/**
 * Cliente HTTP minimalista para el motor FWD Contable AI.
 * - Inyecta automáticamente Bearer token (si hay uno guardado).
 * - Maneja errores en formato { error, codigo, detalle } del backend.
 * - En dev usa el proxy de Vite (relative URLs).
 * - En prod local (frontend servido desde Express) las URLs relativas pegan al mismo origin.
 * - En prod separado (frontend en Easypanel + backend via túnel HTTPS) el build define
 *   VITE_API_URL al dominio del túnel; el cliente prefija esa URL en cada request.
 */

const API_BASE = (import.meta.env.VITE_API_URL ?? '').replace(/\/+$/, '');

function fullUrl(path: string): string {
  if (!API_BASE) return path; // relative (dev con proxy, o prod servido por el mismo Express)
  return path.startsWith('http') ? path : `${API_BASE}${path}`;
}

/**
 * Mapa de códigos de error del backend → texto amigable para el contador.
 * Si el código no está mapeado, se muestra el `message` original del backend.
 */
const ERRORES_HUMANOS: Record<string, string> = {
  TOKEN_INVALIDO: 'Tu sesión expiró. Iniciá sesión de nuevo.',
  CREDENCIALES_INVALIDAS: 'Email o contraseña incorrectos.',
  AUTH_ERROR: 'No se pudo verificar tu identidad. Intentá entrar de nuevo.',
  PERMISO_DENEGADO: 'No tenés permiso para hacer esa acción.',
  ARCHIVO_INVALIDO: 'El archivo no se pudo procesar. Asegurate que sea un PDF o XML válido.',
  EMPRESA_DESCONOCIDA: 'La empresa indicada no está registrada en el sistema.',
  EMPRESA_REQUERIDA: 'Falta indicar a qué empresa pertenece esta factura.',
  FACTURA_INVALIDA: 'La factura no pudo ser leída correctamente. Verificá que el PDF sea legible.',
  FACTURA_OTRA_EMPRESA: 'Esta factura es de otra empresa. Cargala en el libro correcto.',
  RECONCILIACION_FALLIDA: 'Los totales de la factura no cuadran. Necesita revisión humana.',
  AGENTE_FALLO: 'El asistente no pudo terminar la consulta. Intentá reformular la pregunta.',
  HACIENDA_ERROR: 'La API de Hacienda no respondió. Reintentá en un minuto.',
  BODY_INVALIDO: 'Los datos enviados no son válidos.',
  QUERY_INVALIDA: 'Los filtros de búsqueda no son válidos.',
  NO_ENCONTRADA: 'No se encontró el recurso solicitado.',
  NOT_FOUND: 'Endpoint no encontrado.',
  INTERNAL_ERROR: 'Ocurrió un error interno. Por favor reintentá; si persiste, contactá al admin.',
  DESCARGA_INVALIDA: 'No se pudo descargar el archivo: el servidor devolvió contenido inesperado. Reintentá; si persiste, avisale al admin.',
  DESCARGA_VACIA: 'El archivo descargado vino vacío. Reintentá en un momento.',
  DESCARGA_CORRUPTA: 'El archivo descargado está corrupto. Reintentá; si persiste, contactá al admin.',
};

export class ApiError extends Error {
  constructor(
    public status: number,
    public codigo: string,
    message: string,
    public detalle?: unknown,
  ) {
    super(message);
    this.name = 'ApiError';
  }

  /** Texto amigable para el contador. Cae al `message` si el código no está mapeado. */
  get humano(): string {
    return ERRORES_HUMANOS[this.codigo] ?? this.message;
  }
}

const TOKEN_KEY = 'fwd_token';

export function getToken(): string | null {
  return localStorage.getItem(TOKEN_KEY);
}

export function setToken(token: string | null): void {
  if (token) localStorage.setItem(TOKEN_KEY, token);
  else localStorage.removeItem(TOKEN_KEY);
}

interface FetchOptions {
  method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  body?: unknown;
  formData?: FormData;
  noAuth?: boolean;
}

async function request<T>(path: string, opts: FetchOptions = {}): Promise<T> {
  const headers: Record<string, string> = {};
  if (!opts.formData) {
    headers['Content-Type'] = 'application/json';
  }
  if (!opts.noAuth) {
    const token = getToken();
    if (token) headers['Authorization'] = `Bearer ${token}`;
  }
  const res = await fetch(fullUrl(path), {
    method: opts.method ?? (opts.body || opts.formData ? 'POST' : 'GET'),
    headers,
    body: opts.formData ?? (opts.body ? JSON.stringify(opts.body) : undefined),
  });

  const text = await res.text();
  let payload: unknown = null;
  try {
    payload = text ? JSON.parse(text) : null;
  } catch {
    payload = { raw: text };
  }

  if (!res.ok) {
    const p = (payload ?? {}) as { error?: string; codigo?: string; detalle?: unknown };
    throw new ApiError(
      res.status,
      p.codigo ?? `HTTP_${res.status}`,
      p.error ?? `Error ${res.status}`,
      p.detalle,
    );
  }
  return payload as T;
}

// ============================================================
// API tipada
// ============================================================

export interface UserPublic {
  id: number;
  email: string;
  nombre: string;
  rol: 'admin' | 'contador';
  empresa_id: string | null;
}

export const api = {
  async health() {
    return request<{ status: string; version: string; db: string }>('/health', { noAuth: true });
  },

  async login(email: string, password: string) {
    return request<{ user: UserPublic; token: string; expira_en: string }>('/auth/login', {
      body: { email, password },
      noAuth: true,
    });
  },

  async me() {
    return request<{
      user: UserPublic | null;
      auth_enabled: boolean;
      empresa?: { id: string; nombre: string };
    }>('/auth/me');
  },

  async procesarDocumento(file: File, empresa_id: string) {
    const fd = new FormData();
    fd.append('file', file);
    fd.append('empresa_id', empresa_id);
    return request<unknown>('/process-document', { formData: fd });
  },

  /**
   * Procesar múltiples archivos (P01: "carpeta"). Soporta hasta 50 archivos.
   * Devuelve un objeto batch con resultados y errores por archivo.
   */
  async procesarDocumentos(files: File[], empresa_id: string) {
    const fd = new FormData();
    for (const f of files) fd.append('files', f);
    fd.append('empresa_id', empresa_id);
    return request<unknown>('/process-document', { formData: fd });
  },

  /** Descarga el Excel "Reintegro Caja Chica" (P01). */
  async descargarExcelReintegro(params: { empresa_id: string; mes?: string; saldo?: boolean }): Promise<Blob> {
    return descargarArchivo(buildUrl('/excel/reintegro', {
      empresa_id: params.empresa_id,
      mes: params.mes,
      saldo: params.saldo ? '1' : undefined,
    }));
  },

  /** Descarga el Excel "Tax-IVA multihoja" (P02). */
  async descargarExcelTaxIva(params: { empresa_id: string; mes?: string }): Promise<Blob> {
    return descargarArchivo(buildUrl('/excel/tax-iva', {
      empresa_id: params.empresa_id,
      mes: params.mes,
    }));
  },

  async listarFacturas(params: {
    empresa_id?: string;
    mes?: string;
    desde?: string;
    hasta?: string;
    limit?: number;
    pendientes_revision?: boolean;
  }) {
    const q = new URLSearchParams();
    for (const [k, v] of Object.entries(params)) {
      if (v === undefined || v === null) continue;
      if (typeof v === 'boolean') {
        if (v) q.append(k, '1');
        continue;
      }
      if (String(v).length > 0) q.append(k, String(v));
    }
    return request<{ total: number; facturas: FacturaResumen[] }>(`/facturas?${q.toString()}`);
  },

  async obtenerFactura(id: string) {
    return request<{ factura: Record<string, unknown>; lineas: Record<string, unknown>[] }>(`/facturas/${encodeURIComponent(id)}`);
  },

  async marcarPagoFactura(args: {
    id: string;
    pagada: boolean;
    fecha_pago?: string;
    notas_pago?: string;
  }) {
    return request<{
      id: string;
      estado_pago: 'pendiente' | 'pagada';
      fecha_pago: string | null;
      notas_pago: string | null;
    }>(`/facturas/${encodeURIComponent(args.id)}/pago`, {
      method: 'PUT',
      body: {
        pagada: args.pagada,
        fecha_pago: args.fecha_pago,
        notas_pago: args.notas_pago,
      },
    });
  },

  async archivarFacturas(args: {
    mes?: string;
    desde?: string;
    hasta?: string;
    ids?: string[];
    incluir_adelantos?: boolean;
  }) {
    return request<{ facturas_archivadas: number; adelantos_archivados: number }>(
      '/facturas/archivar',
      { method: 'POST', body: args },
    );
  },

  async restaurarFactura(id: string) {
    return request<{ ok: boolean; id: string }>(
      `/facturas/${encodeURIComponent(id)}/restaurar`,
      { method: 'POST', body: {} },
    );
  },

  async historial(params: { empresa_id?: string; mes?: string; limit?: number }) {
    const q = new URLSearchParams();
    for (const [k, v] of Object.entries(params)) {
      if (v !== undefined && v !== null && String(v).length > 0) q.append(k, String(v));
    }
    return request<{
      total: number;
      activas: number;
      archivadas: number;
      facturas: FacturaResumen[];
    }>(`/historial?${q.toString()}`);
  },

  async descargarRespaldoCompleto(params: { empresa_id: string; mes?: string; desde?: string; hasta?: string }): Promise<Blob> {
    return descargarArchivo(buildUrl('/excel/respaldo', {
      empresa_id: params.empresa_id,
      mes: params.mes,
      desde: params.desde,
      hasta: params.hasta,
    }));
  },

  async marcarRevisionFactura(args: {
    id: string;
    revisada: boolean;
    notas?: string;
  }) {
    return request<{
      id: string;
      revisada_por_humano: number;
      fecha_revision: string | null;
      notas_revision: string | null;
    }>(`/facturas/${encodeURIComponent(args.id)}/revision`, {
      method: 'PUT',
      body: {
        revisada: args.revisada,
        notas: args.notas,
      },
    });
  },

  async tipoCambio(moneda: 'USD' | 'EUR' = 'USD', fecha?: string) {
    const q = new URLSearchParams({ moneda });
    if (fecha) q.append('fecha', fecha);
    return request<{ moneda: string; compra: number; venta: number; fecha_solicitada: string; fecha_vigente: string; fuente: string }>(`/hacienda/tc?${q.toString()}`);
  },

  async preguntarAsistente(mensaje: string, empresa_id?: string, incluir_historial = true) {
    return request<{ respuesta: string; sql_ejecutado: string | null; filas_devueltas: number; duracion_ms: number }>('/chat', {
      body: { mensaje, empresa_id, incluir_historial },
    });
  },

  async historialChat(limit = 20) {
    return request<{ user_id: number; total: number; turnos: Array<{ rol: 'user' | 'assistant'; mensaje: string; timestamp?: string }> }>(`/chat/historial?limit=${limit}`);
  },

  async saldoCajaChica(empresa_id: string) {
    return request<{
      empresa_id: string;
      desde: string;
      hasta: string;
      adelantos_abiertos_crc: number;
      facturas_periodo_crc: number;
      cantidad_adelantos: number;
      cantidad_facturas: number;
      saldo: number;
    }>(`/caja-chica/saldo?empresa_id=${encodeURIComponent(empresa_id)}`);
  },

  async crearAdelanto(args: {
    empresa_id: string;
    monto_crc: number;
    fecha_entrega: string;
    responsable?: string;
    notas?: string;
  }) {
    return request<{ id: number; empresa_id: string; monto_crc: number; fecha_entrega: string; estado: string }>(
      '/adelantos',
      { body: args },
    );
  },

  // ============================================================
  // Admin (rol admin)
  // ============================================================

  async adminStats() {
    return request<{
      total_empresas: number;
      total_facturas: number;
      total_usuarios: number;
      facturas_revision_humana: number;
      mes_actual: string;
      facturas_mes: number;
      total_crc_mes: number;
      procesamientos_mes: number;
    }>('/admin/stats');
  },

  async adminListUsers() {
    return request<{
      total: number;
      users: Array<{
        id: number;
        email: string;
        nombre: string;
        rol: 'admin' | 'contador';
        empresa_id: string | null;
        empresa_nombre: string | null;
        activo: number;
        ultimo_login: string | null;
        creado: string;
      }>;
    }>('/admin/users');
  },

  async adminCreateUser(args: {
    email: string;
    password: string;
    nombre: string;
    rol: 'admin' | 'contador';
    empresa_id?: string | null;
  }) {
    return request<UserPublic>('/admin/users', { body: args });
  },

  async adminToggleUser(id: number, activo: boolean) {
    return request<{ ok: boolean }>(`/admin/users/${id}`, {
      method: 'PATCH',
      body: { activo },
    });
  },

  async adminListEmpresas() {
    return request<{
      total: number;
      empresas: Array<{
        id: string;
        nombre: string;
        tipo_cedula: string;
        moneda_principal: string;
        estado: string;
        total_facturas: number;
        facturas_mes: number;
        total_crc_mes: number;
      }>;
    }>('/admin/empresas');
  },

  async adminCreateEmpresa(args: {
    id: string;
    nombre: string;
    tipo_cedula?: 'fisica' | 'juridica' | 'dimex' | 'nite';
    actividad_economica?: string;
    moneda_principal?: 'CRC' | 'USD' | 'EUR';
  }) {
    return request<{ ok: boolean; empresa_id: string; nombre: string }>('/admin/empresas', {
      body: args,
    });
  },
};

// ============================================================
// Helpers para descarga binaria (Excel)
// ============================================================

function buildUrl(path: string, params: Record<string, string | undefined>): string {
  const q = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined && v !== null && v.length > 0) q.append(k, v);
  }
  const qs = q.toString();
  return qs ? `${path}?${qs}` : path;
}

async function descargarArchivo(path: string): Promise<Blob> {
  const token = getToken();
  const headers: Record<string, string> = {};
  if (token) headers['Authorization'] = `Bearer ${token}`;
  const res = await fetch(fullUrl(path), { headers });
  if (!res.ok) {
    const text = await res.text();
    let codigo = `HTTP_${res.status}`;
    let mensaje = `Error ${res.status}`;
    try {
      const p = JSON.parse(text) as { codigo?: string; error?: string };
      codigo = p.codigo ?? codigo;
      mensaje = p.error ?? mensaje;
    } catch {
      /* el backend devolvió texto, no JSON */
    }
    throw new ApiError(res.status, codigo, mensaje);
  }

  // Defensa en profundidad: si el server respondió 200 pero el body es HTML
  // o JSON (típicamente cuando el proxy de dev no está configurado y Vite
  // devuelve el index.html de la SPA como fallback), abortamos en vez de
  // entregar al usuario un archivo corrupto que Excel no puede abrir.
  const contentType = res.headers.get('Content-Type') ?? '';
  const blob = await res.blob();
  if (contentType.includes('text/html') || contentType.includes('application/json')) {
    throw new ApiError(
      502,
      'DESCARGA_INVALIDA',
      'El servidor devolvió un archivo inválido. Probablemente el motor está caído o el proxy de desarrollo no está configurado.',
    );
  }
  // Validar magic number ZIP (xlsx = PK\x03\x04 = 50 4B 03 04).
  if (blob.size < 4) {
    throw new ApiError(502, 'DESCARGA_VACIA', 'El archivo descargado vino vacío.');
  }
  const head = await blob.slice(0, 4).arrayBuffer();
  const bytes = new Uint8Array(head);
  const esZip = bytes[0] === 0x50 && bytes[1] === 0x4b && bytes[2] === 0x03 && bytes[3] === 0x04;
  if (!esZip) {
    throw new ApiError(
      502,
      'DESCARGA_CORRUPTA',
      'El archivo descargado no es un Excel válido. Reintentá; si persiste, contactá al admin.',
    );
  }
  return blob;
}

export function descargarBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 0);
}

export interface FacturaResumen {
  id: string;
  empresa_id: string;
  fecha_emision: string;
  proveedor_cedula: string;
  proveedor_nombre: string | null;
  moneda: string;
  total_factura: number;
  total_crc: number;
  iva_total_crc: number;
  estado_hacienda: string | null;
  requiere_revision_humana: number;
  motivo_revision: string | null;
  estado_pago: 'pendiente' | 'pagada';
  fecha_pago: string | null;
  revisada_por_humano: number;
  fecha_revision: string | null;
  archivada: number;
  fecha_archivado: string | null;
}
