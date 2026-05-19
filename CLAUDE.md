# CLAUDE.md — Contexto del proyecto FWD Contable AI

> Este archivo es leído automáticamente por Claude Code al abrir el proyecto. Contiene TODO el contexto necesario para trabajar sin preguntar. Si sos una sesión nueva: leelo entero antes de actuar.

---

## 1. TL;DR

Sistema multiagente de contabilidad para Costa Rica, construido para **Forward Costa Rica** (firma contable). Procesa facturas (PDF nativo, PDF escaneado, XML Hacienda), las clasifica según las 6 tarifas de IVA costarricenses, escribe en un Google Sheet con formato oficial y permite al contador hacer consultas en lenguaje natural.

Es **un solo sistema multiagente** que cubre los 3 proyectos del taller de Randall Leiton (2026): DocScan Finance CR + Tax IVA Intelligence CR + Smart Accounting AI.

Cliente piloto: **FUNDACION CRC Endurance** (cédula jurídica 3-006696489). El sistema está diseñado multi-tenant: una sola instancia maneja múltiples empresas cliente.

---

## 2. Usuario final

Contador de Forward Costa Rica, 50+ años, **no técnico**. Hoy hace todo a mano:

1. Recibe facturas físicas / PDFs escaneados / PDFs nativos / XMLs de Hacienda CR.
2. Las transcribe a mano a un Excel "Reintegro de Caja Chica" (formato Forward Costa Rica).
3. Calcula el IVA línea por línea aplicando las 6 tarifas costarricenses.
4. Cuando le preguntan "¿cuánto se gastó este mes?" abre 12 archivos y filtra manualmente.

Le toma **horas por semana**. El sistema debe ser **100 % funcional, no demo** — usable desde el día uno sin saber código, IA ni APIs.

---

## 3. Restricciones duras (no negociables)

### Stack permitido

- JavaScript / TypeScript (Node.js 20+).
- React + Vite para el frontend (mínimo, sin Next.js, sin SSR).
- SQLite (vía `better-sqlite3`).
- Claude Agent SDK (`@anthropic-ai/claude-agent-sdk`) autenticado con la suscripción Claude Code Max plan del usuario (cero costo de API).
- Google Sheets API (vía `googleapis`).
- n8n self-hosted (ya existente).

### Prohibido

- ❌ **Python** o cualquier dependencia que requiera Python (Tesseract, scripts CLI con shebang `#!/usr/bin/env python`, etc.). Claude Vision hace OCR nativo.
- ❌ **`git push` a GitHub**. Los commits los hace el usuario manualmente cuando él decida. Solo `git init` y `git commit` locales están permitidos.
- ❌ **Postgres / MySQL / Redis**. SQLite alcanza.
- ❌ **Docker en desarrollo local**. Solo en deploy a Easypanel (Fase 5).
- ❌ **Tailwind / MUI / AntD** a menos que el usuario lo pida explícitamente. CSS plano por ahora.
- ❌ **Tesseract / OCR locales**. Claude Vision lo cubre.
- ❌ **Frameworks fullstack tipo Next.js**. Express puro para backend, Vite + React puro para frontend.

### Reglas de comunicación

- Responder en **español de Costa Rica** al usuario final (el contador).
- El usuario que da las instrucciones habla español. Las respuestas técnicas pueden ser en español.
- **Avisar siempre** al usuario antes de usar una librería que él pueda no conocer.

---

## 4. Arquitectura (3 capas)

```
+-----------------------------------------------------------------+
|  CAPA 1 — UX / Orquestador                                      |
|  n8n self-hosted en Easypanel                                   |
|  onlyautotask-n8n.tuoaro.easypanel.host                         |
|                                                                 |
|  Triggers:                                                      |
|   - Form web "Subir factura" (PDF/XML upload)                   |
|   - Chat "Preguntar al asistente"                               |
|   - Schedule diario (pull XMLs Hacienda — fase 2)               |
|   - WhatsApp Business (fase 5 opcional)                         |
|                                                                 |
|  n8n NO razona. Solo dispara webhooks al motor.                 |
+----------------------------------+------------------------------+
                                   | HTTP (JSON)
                                   v
+-----------------------------------------------------------------+
|  CAPA 2 — Motor de IA                                           |
|  Node.js 24 + Express + Claude Agent SDK + React (frontend)     |
|  Corre local en PC Windows (F1-F4) -> Easypanel (F5)            |
|                                                                 |
|  Endpoints REST:                                                |
|   POST /process-document  -> DocScan + Tax-IVA                  |
|   POST /process-folder    -> procesa una carpeta entera         |
|   POST /chat              -> Asistente Contable                 |
|   POST /auth/login        -> JWT (F3)                           |
|   GET  /health                                                  |
|                                                                 |
|  Sub-agentes (uno por skill, cargados desde backend/skills/):    |
|   - DocScan           (docscan.md)                              |
|   - TaxIVA            (tax-iva.md)                              |
|   - AsistenteContable (asistente-contable.md)                   |
|                                                                 |
|  Frontend (React + Vite, servido en otro puerto durante dev):   |
|   - Login                                                       |
|   - Subir factura (P01, P02)                                    |
|   - Detalle factura procesada (P02)                             |
|   - Resumen por tarifa IVA (P02)                                |
|   - Chat (P03)                                                  |
|   - Historial conversaciones (P03)                              |
|   - Panel admin (P03)                                           |
+----------------------------------+------------------------------+
                                   | MCP (stdio)
                                   v
+-----------------------------------------------------------------+
|  CAPA 3 — Tools y Storage                                       |
|                                                                 |
|  MCP servers custom (en mcp-servers/):                          |
|   - mcp-hacienda-cr  -> tipo cambio + padrón cédulas + CABYS    |
|   - mcp-fwd-db       -> queries SQL SQLite (lectura/escritura)  |
|                                                                 |
|  MCP server oficial:                                            |
|   - google-sheets-mcp -> escribe machote Forward CR             |
|                                                                 |
|  Storages:                                                      |
|   - Google Sheets (vista del contador, machote 4 hojas)         |
|   - SQLite        (memoria del Asistente, multi-tenant)         |
|   - Filesystem    (PDFs/XMLs archivados en backend/data/storage) |
+-----------------------------------------------------------------+
```

---

## 5. Los 3 proyectos del catálogo del taller

Tomados del documento "Ejercicios del Taller de Contabilidad — Randall Leiton 2026". Los 3 se implementan como **un solo sistema multiagente**, no como apps separadas.

### Proyecto 01 — DocScan Finance CR

- Procesar PDFs de una carpeta, extraer datos mediante IA, generar Excel "Reintegro de Caja Chica".
- Stack obligado: Node.js + Express, API REST, IA Claude.
- Datos a extraer por factura: Fecha, Proveedor, Cédula, No. Factura, Descripción, Monto CRC.
- Calcular Total CRC y saldo líquido (saldo = adelanto − Σ facturas).
- Indicador de facturas con datos faltantes; registro de facturas no reconocidas.
- **Extras opcionales**: validación cédula vs padrón Hacienda, soporte XML Hacienda, envío correo automático, interfaz gráfica con progreso.

### Proyecto 02 — Tax IVA Intelligence CR

- Procesar facturas PDF (escaneadas) y XML (Hacienda CR).
- Clasificar cada línea según las 6 tarifas de IVA: 0 %, 1 %, 2 %, 4 %, 13 %, Exento.
- Excel multihoja: Hoja 1 detalle con 24 columnas oficiales de Hacienda + Hoja 2 resumen por tarifa.
- Multimoneda con tipo de cambio oficial vía API pública de Hacienda CR (sin auth).
- Frontend: panel de carga PDF/XML, detalle por factura, resumen por tarifa, descarga Excel.
- IA: identificar categoría fiscal, calcular base/IVA/total por línea, reconciliar, detectar inconsistencias.
- **Extras**: notas crédito/débito, historial, exportar PDF, alertas IVA incorrecto, fallback gratuito de TC (jsdelivr/frankfurter).

### Proyecto 03 — Smart Accounting AI

- Chatbot contable que responde en lenguaje natural sobre facturas, gastos, ingresos, pagos, vencimientos.
- Stack obligado: Node.js + Express + JWT + roles + DB SQL.
- Frontend: chat + historial + panel admin.
- IA: NLP, traduce preguntas a queries SQL, responde contextual.
- Consultas tipo: "¿Cuánto se gastó este mes?", "¿Qué proveedor tuvo más facturas?", "¿Facturas vencidas?".
- **Extras**: TTS, WhatsApp Business, reportes desde chat, RAG con PDFs.

---

## 6. Datos reales observados — facturas y dialectos

Tenemos **4 PDFs golden** archivados en `backend/tests/fixtures/`. Son facturas reales del cliente FUNDACION CRC Endurance. Cubren 5 dialectos distintos de proveedores costarricenses.

### Dialecto 1: CSU (Corporación Supermercados Unidos) — FE v4.4

- Logo "CSU" azul/verde.
- **Columna IMP vacía**: tarifa de IVA por línea NO mostrada explícitamente.
- `precio_unitario` SIN IVA, `monto` (columna MONTO) CON IVA.
- Subtotal pie = suma de (precio × cantidad), sin IVA.
- **Regla**: setear `tarifa_iva_marcada: null`, dejar que Tax-IVA infiera.

Ejemplo (CSU Rompope, clave `50626112500310200722315100046010000285222100000000`):
- ROMPOPE 1L × 8: precio_unit 2.592,92 × 8 = 20.743,36 → monto 23.440 → IVA derivado 2.696,64 = **13 %**.
- SALS CRI LIZ × 1: precio_unit 2.504,95 → monto 2.530 → IVA derivado 25,05 = **1 %**.
- Total: ₡25.970. **Factura con tarifa mixta**.

### Dialecto 2: ALPEMUSA / Pequeño Mundo — FE v4.3

- Logo "PEQUEÑO MUNDO" colorido sobre fondo rojo.
- Tarifa aparece **debajo del código** como texto: `IVA 1%`, `IVA 13%`, etc.
- `precio` y `total` por línea son **CON IVA**.
- Descripciones pueden venir multilinea (ej: `"Caja heavy duty plástica\n100lt"`) — re-juntarlas.

### Dialecto 3: PriceSmart — FE

- Logo "PRICESMART Membership Shopping".
- Cada línea termina con una letra fiscal: `G`, `P`, `M`, `S`, `E`.
- Leyenda al pie: `E=0% P=1% M=2% S=4% G=13%`.
- Precios mostrados son **CON IVA**.
- Boilerplate "Código Reg. Fiscal de bebidas alcohólicas N° 4205. Según Ley 8707" aparece en TODOS los tickets — **ignorar**, no implica que la factura tenga alcohol.

### Dialecto 4: Almacenes El Rey — FE v4.3

- Logo "ALMACENES EL REY" con corona.
- Tabla formal con columnas: `CÓDIGO | DESCRIPCIÓN | MEDIDA | CANT | UNITARIO | DESCUENTO | % | IVA | TOTAL`.
- Columna `%` muestra la tarifa (`13.`).
- `UNITARIO` SIN IVA, `TOTAL` CON IVA.
- El más fácil de parsear.

### Dialecto 5: Market Río Oro — dos sub-formatos

- **Formal**: tabla con columna `%imp` que indica tarifa. Limpio.
- **Ticket escaneado con anotación a lápiz**: OCR potencialmente destruido. **Único caso que requiere fallback**: leer SOLO el pie (IVA + Total), reconstruir tarifa por aritmética, marcar `requiere_revision_humana: true` con motivo `OCR_DEGRADADO`.

---

## 7. Tarifas IVA de Costa Rica (normativa vigente 2026)

| Tarifa | Categoría | Aplica a |
|---|---|---|
| 0 % | Canasta Básica | Arroz, frijoles, leche fluida sin marca |
| 1 % | Medicamentos / canasta básica reducida | Productos farmacéuticos, algunos básicos empacados |
| 2 % | Turismo | Servicios turísticos registrados ante ICT |
| 4 % | Salud Privada | Consultas médicas y servicios de salud privados |
| 13 % | General | Default para bienes y servicios |
| Exento | Exento | Exportaciones, educación, intereses bancarios |

**Regla universal**: la factura manda. Si el proveedor marca una tarifa, esa es la legal. NO clasificar por nombre del producto. Ejemplo real: PriceSmart marcó `CafeEspecia` como P (1 %); azúcar Don Harris empacada apareció con tarifa 1 % en Market Río Oro. Confiar en lo que dice la factura.

---

## 8. Machote Forward CR — formato exacto

Tres hojas en un mismo Google Sheet por empresa cliente. Esquema completo en `backend/schemas/sheet-layout.md`.

### Hoja 1: "Reintegro Caja Chica" — vista del contador

Headers (fila 5):

| Col | Header |
|---|---|
| A | Fecha |
| B | Proveedor |
| C | Cédula física o jurídica |
| D | No. Factura |
| E | Descripción |
| F | Moneda (CRC o USD) |
| G | Monto del documento |
| H | Monto Gravado |
| I | % IVA |
| J | Monto IVA |
| K | Total |

Pie: `Total USD: ₡X` y `Total CRC: ₡X` calculados con SUMIF.

**Regla de agrupación**: si una factura tiene múltiples tarifas, se escribe una fila por tarifa (no por línea). Las columnas Fecha, Proveedor, Cédula, No. Factura, Monto del documento se REPITEN; las columnas de la tarifa varían.

### Hoja 2: "Detalle Hacienda" — vista fiscal (24 columnas)

Clave (50 dígitos) · Numeración Consecutiva (20 dígitos) · Tipo Documento · Consecutivo Nota Referencia · Actividad Económica · Fecha Emisión · Fecha de carga · Nombre Proveedor · Tipo Cédula · Cédula Proveedor · Estado Hacienda · Moneda · Tipo Cambio · Total Gravado · Total Exento · Descuento · SubTotal · Sub total Colones · Otros Cargos · Porcentaje Impuesto · Total Impuesto · Impuesto en Colones · Total Factura · Total Colones.

Una fila por factura completa.

### Hoja 3: "Resumen por Tarifa" — fórmulas SUMIF

| Tarifa IVA | # Líneas | Base Gravable CRC | Monto IVA CRC | Total con IVA CRC | % del Total |

### Hoja 4: "Para Revisión" — filtrada

Vista filtrada de Hoja 1 donde `requiere_revision_humana = TRUE`. Una columna extra con el motivo en español humano.

### Estilo

- Header morado Forward (#6B2C8F) texto blanco.
- Filas alternadas gris claro (#F4F4F4).
- Montos: alineados derecha, formato `₡#.##0,00`.
- % IVA: centrado, formato `0%`.
- Filas con revisión humana: fondo amarillo (#FFF3CD).

---

## 9. Multi-tenancy

Forward Costa Rica es una **firma contable** que maneja múltiples empresas cliente. Confirmado porque:

- Las facturas tienen receptor `FUNDACION CRC Endurance (3006696489)`.
- El workbook de EEFF de muestra es de `SERVICIOS INTERNACIONALES, S.A. (3101813165)` — empresa distinta.
- El prefijo `03.` en `03. Servicios Internacionales EEFF 032025.xlsm` sugiere numeración de cliente.

**Reglas multi-tenant**:

- TODA tabla contable tiene `empresa_id` (cédula jurídica sin guiones).
- TODA query filtra por `empresa_id`.
- Cada empresa tiene su propio Google Sheet machote.
- Cada empresa tiene su propio chart of accounts (futuro).

**Empresa piloto activa**: FUNDACION CRC Endurance (id `3006696489`). El sistema soporta agregar más con un `INSERT INTO empresas`.

---

## 10. Chart of Accounts costarricense (estructura observada)

Formato: `D-S-GG-CC-DD-EE` (12 dígitos en 6 grupos).

| Dígito 1 | Naturaleza |
|---|---|
| 1 | Activo |
| 2 | Pasivo |
| 3 | Patrimonio |
| 4 | Ingresos |
| 6 | Gastos |
| 7 | Otros Ingresos |
| 8 | Otros Gastos |

Ejemplos reales del workbook EEFF de Servicios Internacionales:

```
1-1-01-01-04-01  Caja Chica
1-1-01-02-02-01  BCT # 1140288 Cta. ¢
1-1-01-02-02-02  BCT # 1140289 Cta. $
1-1-05-05-05-00  IVA Crédito Fiscal al 13%
1-1-02-01-01-00  CxC Clientes Comerciales
2-1-01-01-01-00  Cuentas por pagar Proveedores Locales
2-1-03-03-05-00  IVA Débito Fiscal al 13%
4-1-01-02-02-00  Ingresos por servicios contables
6-2-02-01-03-01  Uniformes (gasto)
6-2-02-04-00-00  Transporte y Viáticos
8-1-01-03-00-00  Gasto por Diferencial Cambiario
```

El tagging automático de cuentas contables NO está en scope de Fases 1-4. Se evalúa para Fase 5+.

---

## 11. Brackets fiscales CR (referencia)

Datos del archivo `Datos de información.xlsx` que vimos en el Drive del taller.

### Renta de salarios (mensual)

| Desde | Hasta | % | Rebajo |
|---|---|---|---|
| 0 | 918.000 | 0 % | 0 |
| 918.000 | 1.347.000 | 10 % | 42.900 |
| 1.347.000 | 2.364.000 | 15 % | 152.550 |
| 2.364.000 | 4.727.000 | 20 % | 472.600 |
| 4.727.000 | 5.000.000 | 25 % | 68.250 |

### Cargas sociales

- Trabajador: 10,83 %
- Patrono: 26,83 %
- Total: 37,66 %

### Trabajador independiente (anual, sobre utilidad neta)

| Desde | Hasta | % |
|---|---|---|
| 0 | 6.244.000 | 0 % |
| 6.244.000 | 8.329.000 | 10 % |
| 8.329.000 | 10.414.000 | 15 % |
| 10.414.000 | 20.872.000 | 20 % |
| 20.872.000 | en adelante | 25 % |

### Sociedades

- Si renta bruta < ₡119.174.000: 5 / 10 / 15 / 20 % por tramos.
- Si renta bruta > ₡119.174.000: 30 % flat.

### Créditos fiscales

- Por cada hijo: ₡1.710/mes (₡20.520/año).
- Por cónyuge: ₡2.590/mes (₡31.080/año).

### Otros

- Renta de alquileres: 15 % sobre 85 % del bruto (= 12,75 % efectivo).
- Impuesto Sociedades anual: ₡115.500 (pequeñas) / ₡231.500 (medianas) / ₡69.330 (inactivas).
- Timbre Educación y Cultura: sobre patrimonio.

---

## 12. Decisiones técnicas tomadas

### Autenticación de Claude

Usar **Claude Agent SDK** autenticado con la suscripción Claude Code Max plan del usuario. **No** llamar a la API de Anthropic directamente con `ANTHROPIC_API_KEY`. Cero costo adicional.

Config: `CLAUDE_AUTH_MODE=claude_code` en `.env`.

### Servicios externos: TODOS gratuitos, sin tarjeta

El presupuesto en APIs externas es **$0**. Las únicas dependencias online son:

- **Claude** → suscripción Claude Code Max plan del usuario (sin API key paga).
- **Hacienda CR** (`api.hacienda.go.cr`) → API pública oficial, sin auth, sin token, sin registro. Cubre tipo de cambio USD/EUR, padrón de contribuyentes y CABYS. Probada en vivo 2026-05-17. Límites: 10 req/seg sostenido, 20 ráfaga (cómodo para uso real).
- **Google Sheets API / Drive API** → free tier permanente, 300 reads/min, sin tarjeta requerida para Service Account. Nuestro uso real es < 10 escrituras/día.
- **Fallback de TC** (solo si Hacienda devuelve 5xx) → `cdn.jsdelivr.net/npm/@fawazahmed0/currency-api` y `api.frankfurter.dev`, ambos sin key.

**BCCR queda descartado** (originalmente listado en Fase 2): aunque su web service es gratis, requiere registro + token por email + variable en `.env`, lo que en la práctica frena el flujo de setup. Hacienda CR ofrece lo mismo sin esos pasos. Si alguna vez se necesita una fuente alternativa, BCCR sigue disponible — pero no es la primaria.

### Base de datos

**SQLite** vía `better-sqlite3`. Archivo en `backend/data/fwd-contable.db`. Schema en `backend/schemas/db.sql`.

Justificación: 1000-10000 facturas/empresa caben de sobra. Cero servidor. WAL mode habilitado.

### Storage del Sheet

Google Sheets vía Service Account (Fase 2). Una hoja por empresa. El ID del Sheet se almacena en `empresas.sheet_id` (campo a agregar cuando se active F2).

### Frontend

**React + Vite**. Sin Next.js, sin SSR, sin Tailwind, sin librerías de componentes. CSS plano. Routing con `react-router-dom`.

Páginas mínimas:
1. `/login` (P03)
2. `/upload` (P01, P02)
3. `/factura/:id` (P02 detalle)
4. `/resumen-iva` (P02 resumen)
5. `/chat` (P03)
6. `/admin` (P03)

### Comunicación frontend - backend

`fetch()` con header `Authorization: Bearer <jwt>`. CORS habilitado en el motor para el origen del frontend dev (Vite suele correr en `:5173`).

### n8n

Self-hosted en `onlyautotask-n8n.tuoaro.easypanel.host` (Easypanel). El motor expone webhooks que n8n consume. n8n maneja schedule, formularios alternativos (no es la UI principal), WhatsApp opcional.

### Deploy

Fases 1-4: desarrollo local en PC Windows del usuario.
Fase 5: deploy del motor a Easypanel (al lado de n8n). Frontend se sirve estático desde el mismo Express.

---

## 13. Stack técnico completo (Fase 1)

### Motor (backend/)

**Dependencias runtime**:

| Lib | Para qué |
|---|---|
| `@anthropic-ai/claude-agent-sdk` | Motor de IA con sub-agentes y skills |
| `express` | HTTP server |
| `multer` | Subir archivos en POST |
| `cors` | Permitir frontend en otro origen |
| `better-sqlite3` | Cliente SQLite síncrono |
| `jsonwebtoken` | JWT (P03) |
| `bcrypt` | Hashing de contraseñas (P03) |
| `dotenv` | Cargar .env |
| `pdf-parse` | Extraer texto de PDF nativo (pure JS) |
| `fast-xml-parser` | Parser de XML Hacienda |
| `ajv` + `ajv-formats` | Validar JSON Schema |
| `winston` | Logs estructurados |
| `zod` | Validar inputs HTTP en runtime |
| `googleapis` | Google Sheets API (Fase 2) |
| `exceljs` | Generar .xlsx local si se requiere (Fase 2 opcional) |
| `uuid` | IDs únicos cuando no hay clave numérica |

**Dependencias dev**:

| Lib | Para qué |
|---|---|
| `typescript` | Lenguaje |
| `tsx` | Runner TS para dev (watch mode) |
| `vitest` | Tests |
| `@types/node`, `@types/express`, `@types/multer`, `@types/jsonwebtoken`, `@types/bcrypt`, `@types/cors`, `@types/pdf-parse` | Tipos |

### Frontend (frontend/)

| Lib | Para qué |
|---|---|
| `react` | UI |
| `react-dom` | Render |
| `react-router-dom` | Routing |
| `vite` | Build tool |
| `@vitejs/plugin-react` | Plugin Vite para React |
| `typescript` | Lenguaje |
| `@types/react`, `@types/react-dom` | Tipos |

---

## 14. Estado del proyecto

### Fase 0 — COMPLETADA

- ✅ Estructura del repo creada.
- ✅ 3 skills en markdown (`backend/skills/`).
- ✅ JSON Schema de factura (`backend/schemas/factura.schema.json`).
- ✅ DB schema SQLite multi-tenant (`backend/schemas/db.sql`).
- ✅ Layout exacto del machote (`backend/schemas/sheet-layout.md`).
- ✅ 4 PDFs golden archivados (`backend/tests/fixtures/`).
- ✅ Documentación: README.md, `docs/00-arquitectura.md`, `docs/01-contexto-ampliado.md`.
- ✅ Git init + 2 commits locales (`0dedd89` y `b7916dd`).
- ✅ `.gitignore` que protege `.env`, credenciales, `.scratch/`, `data/`.

### Fase 1 — COMPLETADA

Ver `docs/FASE-1-REPORTE.md`.

- ✅ Motor Express con endpoints `/health` y `/process-document` funcionales.
- ✅ Sub-agentes DocScan y Tax-IVA con Claude Agent SDK cargando los skills.
- ✅ Validación con Ajv contra `factura.schema.json`.
- ✅ SQLite inicializada desde `db.sql`.
- ✅ Tests passing con los 4 PDFs golden (Caja Chica en skip hasta Fase 2).

### Fase 2 — COMPLETADA (con bootstrap manual del Sheet pendiente)

Ver `docs/FASE-2-REPORTE.md`.

- ✅ MCPs in-process `hacienda-cr` (TC + padrón + CABYS) y `fwd-db` (SELECT-only + helpers).
- ✅ Service Account Google + librería `sheets.ts` con createMachote/appendFactura/markRevision.
- ✅ Splitter de PDFs multi-factura con `pdf-lib` — Caja Chica Santa Ana detecta 6 sub-facturas.
- ✅ Vision para PDFs escaneados (Read tool habilitado on-demand).
- ✅ Endpoints `/hacienda/tc`, `/hacienda/cedula/:cedula`, `/facturas`, `/adelantos`, `/caja-chica/saldo`.
- ✅ Caches: `tipo_cambio_cache`, `cedulas_cache` (TTL 30d), `adelantos_caja_chica`.
- ✅ 16/16 tests verdes en ~125s.
- ⏳ Bootstrap del Sheet machote: la SA en cuenta personal NO tiene quota de Drive. Solución de 5 clics documentada en el reporte.

### Fase 3 — Pendiente

- Asistente Contable: skill ya escrita, falta endpoint `/chat`.
- JWT + roles + tabla users.

### Fase 4 — Pendiente

- Frontend React completo.
- Workflows n8n exportados como `.json`.

### Fase 5 — Pendiente

- Pulido UX para contador.
- Deploy a Easypanel.
- WhatsApp opcional.

---

## 15. Cómo arrancar (cuando Fase 1 esté lista)

```powershell
cd "C:\Users\torme\OneDrive\Desktop\FWD Contable AI\backend"
npm install
Copy-Item .env.example .env
# Editar .env si hace falta
npm run db:init
npm run dev
```

En otro terminal, probar:

```powershell
curl -F "file=@tests/fixtures/50626112500310200722315100046010000285222100000000.pdf" `
     -F "empresa_id=3006696489" `
     http://localhost:3000/process-document
```

Tests:

```powershell
npm test
```

---

## 16. Mapa de archivos importantes

```
FWD Contable AI/
├── CLAUDE.md                                  Este archivo. Contexto completo.
├── README.md                                  Visión rápida del proyecto.
├── .gitignore                                 Protege secretos y datos locales.
├── docs/
│   ├── 00-arquitectura.md                     Diagrama de 3 capas + flujos.
│   ├── 01-contexto-ampliado.md                Info del workbook EEFF, chart of accounts, brackets.
│   └── PROMPT-FASE-1.md                       Prompt para ejecutar Fase 1.
├── backend/                                    Backend Node.js + Agent SDK.
│   ├── skills/
│   │   ├── docscan.md                         Reglas de extracción por dialecto.
│   │   ├── tax-iva.md                         Reglas de clasificación y reconciliación.
│   │   └── asistente-contable.md              Reglas del chatbot NL->SQL.
│   ├── schemas/
│   │   ├── factura.schema.json                Contrato JSON entre DocScan y Tax-IVA.
│   │   ├── db.sql                             Schema SQLite multi-tenant.
│   │   └── sheet-layout.md                    Layout exacto del machote Forward CR.
│   ├── tests/fixtures/                        4 PDFs golden + README con valores esperados.
│   ├── package.json                           Dependencias.
│   ├── tsconfig.json                          Config TypeScript.
│   └── .env.example                           Slots de credenciales.
├── frontend/                                  (a crear en Fase 1) React + Vite.
├── mcp-servers/                               (a crear en Fase 2) MCPs custom.
└── n8n-workflows/                             (a crear en Fase 4) .json importables.
```

---

## 17. Reglas operativas (cómo trabajar en este repo)

1. **Nunca `git push`**. Solo commits locales. El usuario sube a GitHub manualmente.
2. **Nunca escribir en `.env`**. Solo en `.env.example`. El usuario llena los valores reales en `.env`.
3. **Nunca commitear nada de `backend/data/`, `credentials/`, `.scratch/`, `*.db`, `node_modules/`**. Están en `.gitignore`.
4. **Skills son sagradas**. Si vas a cambiar un skill (`.md` en `backend/skills/`), documentá por qué en el commit. Esos archivos son el "cerebro" del sistema.
5. **Tests antes que features**. Cualquier endpoint debe tener test contra los 4 PDFs golden o equivalente.
6. **Mensajes para el contador en español de CR**. El contador no entiende inglés ni jerga técnica.
7. **No inventar números**. Si una query devuelve 0 filas, decirlo. No hacer aproximaciones para "rellenar".
8. **Reconciliación obligatoria**. Cualquier cálculo de IVA debe verificarse contra el pie de la factura con tolerancia de ±₡1.
9. **Avisar antes de instalar librerías nuevas** que no estén listadas en la sección 13.
10. **Idempotencia**. Procesar dos veces la misma factura (misma `clave_numerica`) NO debe duplicar filas.

---

## 18. Glosario rápido

| Término | Definición |
|---|---|
| **Caja Chica** | Fondo en efectivo para gastos menores, controlado por el contador. |
| **Reintegro de Caja Chica** | Reporte que pide reponer el efectivo gastado, presentando facturas. |
| **Machote** | Plantilla. "El machote de Forward CR" = la plantilla de Excel que ellos usan. |
| **Adelanto** | Efectivo entregado al contador antes de procesar facturas. Saldo final = adelanto − Σ facturas. |
| **Clave numérica** | Identificador único de 50 dígitos de la factura electrónica Hacienda CR. |
| **Consecutivo** | Número interno del proveedor, 20 dígitos. |
| **FE** | Factura Electrónica. |
| **TE** | Tiquete Electrónico. |
| **NC / ND** | Nota de Crédito / Nota de Débito. |
| **BBCC** | Balanza de Comprobación (trial balance). |
| **BSF** | Balance de Situación Financiera (balance sheet). |
| **ERI** | Estado de Resultados Integral (income statement). |
| **ECP** | Estado de Cambios en el Patrimonio. |
| **EFE** | Estado de Flujos de Efectivo (cash flow). |
| **DGT** | Dirección General de Tributación. |
| **Padrón Hacienda** | Registro oficial de contribuyentes activos. |
| **BCCR** | Banco Central de Costa Rica. |
| **SDR** | Servicio de Datos del BCCR (web service para tipo de cambio). |
| **GEE BCCR** | Gestor de Indicadores Económicos del BCCR. |
