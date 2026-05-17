-- FWD Contable AI — Schema SQLite
-- Memoria compartida del sistema multiagente.
-- El agente Tax-IVA escribe (vía MCP fwd-db, modo escritura).
-- El agente Asistente Contable lee (vía MCP fwd-db, modo solo lectura).

PRAGMA foreign_keys = ON;
PRAGMA journal_mode = WAL;

-- ============================================================
-- CATÁLOGOS
-- ============================================================

CREATE TABLE IF NOT EXISTS tarifas_iva (
  tarifa     INTEGER PRIMARY KEY,             -- 0, 1, 2, 4, 13
  categoria  TEXT NOT NULL,                   -- "Canasta Básica", "Medicamentos", etc.
  descripcion TEXT NOT NULL
);

INSERT OR IGNORE INTO tarifas_iva (tarifa, categoria, descripcion) VALUES
  (0,  'Canasta Básica',          'Arroz, frijoles, leche fluida sin marca, productos básicos puros'),
  (1,  'Medicamentos / Reducida', 'Productos farmacéuticos, canasta básica empacada de marca'),
  (2,  'Turismo',                 'Servicios turísticos registrados ante el ICT'),
  (4,  'Salud Privada',           'Consultas médicas y servicios de salud privados'),
  (13, 'General',                 'Tarifa general aplicable por defecto a bienes y servicios');

CREATE TABLE IF NOT EXISTS proveedores (
  cedula              TEXT PRIMARY KEY,
  tipo_cedula         TEXT CHECK (tipo_cedula IN ('fisica','juridica','dimex','nite')),
  nombre              TEXT NOT NULL,
  actividad_economica TEXT,
  estado_padron       TEXT CHECK (estado_padron IN ('activo','inactivo','desconocido')) DEFAULT 'desconocido',
  primera_vez_visto   TEXT DEFAULT (datetime('now')),
  ultima_vez_visto    TEXT DEFAULT (datetime('now'))
);

-- ============================================================
-- FACTURAS
-- ============================================================

CREATE TABLE IF NOT EXISTS facturas (
  id                       TEXT PRIMARY KEY,                  -- clave_numerica si existe; sino UUID
  clave_numerica           TEXT UNIQUE,                       -- 50 dígitos (puede ser NULL en facturas escaneadas)
  consecutivo              TEXT,                              -- 20 dígitos
  tipo_documento           TEXT CHECK (tipo_documento IN ('FE','TE','NC','ND')),
  fecha_emision            TEXT NOT NULL,                     -- ISO YYYY-MM-DD
  hora_emision             TEXT,
  fecha_procesamiento      TEXT NOT NULL DEFAULT (datetime('now')),
  proveedor_cedula         TEXT NOT NULL,
  receptor_cedula          TEXT,                              -- normalmente 3006696489 (FUNDACION CRC Endurance)
  receptor_nombre          TEXT,
  moneda                   TEXT NOT NULL CHECK (moneda IN ('CRC','USD','EUR')),
  tipo_cambio              REAL,                              -- 1.0 si moneda = CRC
  subtotal                 REAL NOT NULL,
  total_gravado            REAL NOT NULL DEFAULT 0,
  total_exento             REAL NOT NULL DEFAULT 0,
  total_exonerado          REAL NOT NULL DEFAULT 0,
  descuento_total          REAL NOT NULL DEFAULT 0,
  iva_total                REAL NOT NULL DEFAULT 0,
  total_factura            REAL NOT NULL,
  -- Versiones en colones (si moneda original es extranjera)
  subtotal_crc             REAL NOT NULL,
  iva_total_crc            REAL NOT NULL,
  total_crc                REAL NOT NULL,
  -- Estado del documento ante Hacienda
  estado_hacienda          TEXT CHECK (estado_hacienda IN ('aceptado','rechazado','pendiente','no_consultado')) DEFAULT 'no_consultado',
  -- Calidad
  fuente                   TEXT NOT NULL CHECK (fuente IN ('pdf_nativo','pdf_escaneado','xml_hacienda')),
  confianza_extraccion     REAL NOT NULL,
  requiere_revision_humana INTEGER NOT NULL DEFAULT 0,        -- 0/1 (SQLite no tiene boolean)
  motivo_revision          TEXT,
  pdf_path                 TEXT,                              -- ruta al PDF original archivado
  xml_path                 TEXT,                              -- ruta al XML original si lo hay
  FOREIGN KEY (proveedor_cedula) REFERENCES proveedores(cedula)
);

CREATE INDEX IF NOT EXISTS idx_facturas_fecha     ON facturas(fecha_emision);
CREATE INDEX IF NOT EXISTS idx_facturas_proveedor ON facturas(proveedor_cedula);
CREATE INDEX IF NOT EXISTS idx_facturas_estado    ON facturas(estado_hacienda);
CREATE INDEX IF NOT EXISTS idx_facturas_revision  ON facturas(requiere_revision_humana) WHERE requiere_revision_humana = 1;

CREATE TABLE IF NOT EXISTS lineas_factura (
  id                  INTEGER PRIMARY KEY AUTOINCREMENT,
  factura_id          TEXT NOT NULL,
  numero_linea        INTEGER NOT NULL,
  codigo              TEXT,
  descripcion         TEXT NOT NULL,
  cantidad            REAL NOT NULL,
  unidad_medida       TEXT,
  precio_unitario     REAL NOT NULL,                          -- tal cual lo extrajo DocScan (con o sin IVA según dialecto)
  precio_es_con_iva   INTEGER NOT NULL DEFAULT 0,             -- 0 = SIN IVA, 1 = CON IVA
  descuento           REAL NOT NULL DEFAULT 0,
  monto_total         REAL NOT NULL,                          -- valor que aparece en la columna TOTAL/MONTO de la factura
  tarifa_iva          INTEGER NOT NULL CHECK (tarifa_iva IN (0,1,2,4,13)),
  tarifa_fuente       TEXT NOT NULL CHECK (tarifa_fuente IN ('marcada','inferida','reconciliada')),
  base_imponible      REAL NOT NULL,                          -- = monto SIN IVA
  iva_calculado       REAL NOT NULL,
  base_imponible_crc  REAL NOT NULL,
  iva_calculado_crc   REAL NOT NULL,
  FOREIGN KEY (factura_id) REFERENCES facturas(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_lineas_factura ON lineas_factura(factura_id);
CREATE INDEX IF NOT EXISTS idx_lineas_tarifa  ON lineas_factura(tarifa_iva);

-- ============================================================
-- AUDITORÍA Y CHAT
-- ============================================================

CREATE TABLE IF NOT EXISTS procesamientos (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  factura_id      TEXT,
  agente          TEXT NOT NULL CHECK (agente IN ('docscan','tax-iva','asistente')),
  evento          TEXT NOT NULL,                              -- "extraccion_ok", "reconciliacion_fallida", etc.
  detalle_json    TEXT,                                       -- payload completo del evento (JSON)
  duracion_ms     INTEGER,
  timestamp       TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS chat_history (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id         TEXT NOT NULL,                              -- identificador del contador (email o cédula)
  rol             TEXT NOT NULL CHECK (rol IN ('user','assistant')),
  mensaje         TEXT NOT NULL,
  sql_ejecutado   TEXT,                                       -- la query que el asistente generó (auditoría)
  filas_devueltas INTEGER,
  timestamp       TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_chat_user_time ON chat_history(user_id, timestamp DESC);

-- ============================================================
-- VISTAS ÚTILES PARA EL ASISTENTE CONTABLE
-- ============================================================

CREATE VIEW IF NOT EXISTS v_resumen_mensual AS
SELECT
  strftime('%Y-%m', fecha_emision) AS mes,
  COUNT(*)                         AS cantidad_facturas,
  SUM(total_crc)                   AS total_crc,
  SUM(iva_total_crc)               AS iva_crc
FROM facturas
GROUP BY strftime('%Y-%m', fecha_emision)
ORDER BY mes DESC;

CREATE VIEW IF NOT EXISTS v_top_proveedores AS
SELECT
  p.nombre,
  p.cedula,
  COUNT(f.id)         AS cantidad_facturas,
  SUM(f.total_crc)    AS total_crc
FROM facturas f
JOIN proveedores p ON p.cedula = f.proveedor_cedula
GROUP BY p.cedula
ORDER BY total_crc DESC;

CREATE VIEW IF NOT EXISTS v_resumen_por_tarifa AS
SELECT
  l.tarifa_iva,
  t.categoria,
  COUNT(*)                       AS cantidad_lineas,
  SUM(l.base_imponible_crc)      AS base_crc,
  SUM(l.iva_calculado_crc)       AS iva_crc,
  SUM(l.base_imponible_crc + l.iva_calculado_crc) AS total_crc
FROM lineas_factura l
JOIN tarifas_iva t ON t.tarifa = l.tarifa_iva
GROUP BY l.tarifa_iva
ORDER BY l.tarifa_iva;
