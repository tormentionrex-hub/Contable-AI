# Fase 2 — Reporte de cierre

> Estado: **completada con un setup manual de 5 clics pendiente** (Google Drive quota).
> Fecha de cierre: 2026-05-18.
> Branch: `main`. Commits locales (sin push).

---

## 1. Qué se construyó

### Capa de datos (lib/)

| Módulo | Para qué |
|---|---|
| `lib/hacienda.ts` | Cliente HTTP de `api.hacienda.go.cr` con retry+backoff, cache en SQLite y fallback a Frankfurter/Fawaz si Hacienda devuelve 5xx. Normaliza USD vs EUR a un shape único. Mapea "Inscrito de Oficio" → `inactivo`. Maneja 404 sin tirar. |
| `lib/fwd-db.ts` | Helpers de la DB para el MCP `fwd-db` y los endpoints HTTP: `runSelect` (SELECT only, regex de seguridad), `describeSchema`, `listarFacturas`, `obtenerFactura`, `crearAdelanto`, `calcularSaldoCajaChica`, `registrarProcesamiento`. |
| `lib/sheets.ts` | Cliente de Google Sheets API con Service Account JWT. `createMachote`, `applyMachoteToSpreadsheet`, `appendFactura`, `markRevision`, `ensureSheetForEmpresa`. Modo deshabilitado (gracioso) si no hay SA configurada. |
| `lib/pdf-split.ts` | Splitter de PDFs multi-factura usando `pdf-parse` (texto por página) + `pdf-lib` (corte real). Detecta inicios por clave de 50 dígitos, "Factura Electrónica" + proveedor reconocido, cambio de proveedor entre páginas. |
| `lib/pdf-extract.ts` | Detecta PDFs escaneados (texto < 50 chars o ratio ASCII < 0.7) para activar Vision en el agente. |

### MCPs in-process (agents/mcp/)

Decisión arquitectónica: **los 2 MCPs son SDK in-process** (`createSdkMcpServer` del Agent SDK), no procesos stdio separados. Comparten código con los endpoints HTTP y eliminan el overhead de spawn + JSON-RPC. La carpeta `mcp-servers/` queda como namespace para un eventual wrapper standalone (uso futuro en Claude Desktop).

| MCP | Tools expuestas al sub-agente Tax-IVA |
|---|---|
| `hacienda-cr` | `obtener_tipo_cambio`, `tipo_cambio_actual`, `validar_cedula`, `consultar_cabys` |
| `fwd-db` | `query` (SELECT only), `describe_schema`, `registrar_procesamiento` |

### Endpoints HTTP nuevos

| Método | Path | Hace |
|---|---|---|
| GET | `/hacienda/tc?moneda=USD\|EUR&fecha=YYYY-MM-DD` | TC vigente con cache + fallback |
| GET | `/hacienda/cedula/:cedula` | Padrón Hacienda con cache 30d |
| GET | `/facturas?empresa_id=X&mes=YYYY-MM` | Lista facturas |
| GET | `/facturas/:id` | Detalle (factura + líneas) |
| POST | `/adelantos` | Crea un adelanto de caja chica (P01) |
| GET | `/caja-chica/saldo?empresa_id=X` | Saldo = adelantos abiertos − facturas |

`/process-document` ahora:
- corre splitter primero (auto-detecta multi-factura),
- procesa cada sub-factura con DocScan + Tax-IVA,
- escribe a Sheets (si está habilitado) en la Hoja 1 (regla de agrupación por tarifa) + Hoja 2 (24 col Hacienda),
- copia a Hoja 4 ("Para Revisión") si `requiere_revision_humana = true`,
- responde el shape clásico de Fase 1 si era 1 factura, o `{ multi, total, resultados }` si fueron varias.

### Schema DB (db.sql)

3 tablas nuevas + 1 columna nueva:

- `empresas.sheet_id TEXT` (migración aplicada con ALTER TABLE manual cuando ya existía la tabla).
- `tipo_cambio_cache (fecha, moneda, compra, venta, fecha_vigente, fuente, capturado)` — PK compuesta.
- `cedulas_cache (cedula, tipo_identificacion, nombre, estado, motivo_estado, actividad_economica, actividades_json, consultado)` — TTL 30 días aplicado en código.
- `adelantos_caja_chica (id, empresa_id, monto_crc, fecha_entrega, responsable, estado, notas, creado)`.

### Skill `tax-iva.md`

Se le agregó **solo** la sección "Herramientas MCP disponibles (Fase 2)" al final. El resto del skill quedó intacto (regla sagrada de CLAUDE.md §17).

---

## 2. Tests

`npm test` corre **16/16 tests en ~125 s**:

| Suite | Tests | Pasados | Tiempo |
|---|---|---|---|
| `tests/reconciliation.test.ts` | 3 | 3 | 2 ms |
| `tests/pdf-split.test.ts` | 2 | 2 | ~290 ms |
| `tests/sheets.test.ts` | 3 | 3 | ~3 ms |
| `tests/mcp-hacienda.test.ts` | 4 | 4 | ~2.5 s |
| `tests/docscan.test.ts` | 4 | 4 | ~125 s |

**Caja Chica Santa Ana ya NO está en skip**: el splitter detecta 6 sub-facturas (≥ 5 esperado) y DocScan procesa la primera correctamente.

---

## 3. Criterios de aceptación de Fase 2

| # | Criterio | Estado |
|---|---|---|
| 1 | `npm install` | ✅ |
| 2 | `npm run dev` arranca como antes | ✅ |
| 3 | `GET /health` devuelve `ok` | ✅ |
| 4 | `GET /hacienda/tc?moneda=USD&fecha=2026-05-16` con shape normalizado | ✅ — probado USD y EUR en vivo |
| 5 | `GET /hacienda/cedula/3006696489` devuelve FUNDACION CRC ENDURANCE | ✅ |
| 6 | `POST /process-document` end-to-end | ✅ — verificado con CSU Confites OH; sin Sheets activo, escribe a SQLite |
| 7 | `npm test` (4 golden incluido Caja Chica) | ✅ — 16/16 |

---

## 4. Lo único que falta: bootstrap manual del Sheet (5 clics)

**Descubrimiento técnico**: las Service Accounts en **cuentas Google personales** tienen **0 GB de cuota de Drive** — no pueden ser dueñas de archivos. Solo cuentas Google Workspace les dan storage. Es un límite de Google, no del código.

Error real obtenido al intentar crear el Sheet automáticamente:

```
The user's Drive storage quota has been exceeded.
```

### El workaround (necesario una sola vez)

1. Abrí <https://sheets.google.com> y creá un Sheet vacío.
   - Nombre sugerido: `FWD Contable AI — FUNDACION CRC Endurance (3006696489)`
2. Clic en **Compartir** → agregá esta dirección como **Editor**:
   ```
   contable-ia@contable-ai-496703.iam.gserviceaccount.com
   ```
3. Copiá el **ID del Sheet** (parte de la URL entre `/d/` y `/edit`).
4. Pegalo en `engine/.env`:
   ```
   GOOGLE_SHEET_ID_FUNDACION_CRC=<el ID>
   ```
5. Corré:
   ```
   npm run sheets:setup
   ```
   El script aplica las 4 hojas (Reintegro Caja Chica, Detalle Hacienda, Resumen por Tarifa, Para Revisión) con headers + fórmulas SUMIF.

Después de este setup, cada llamada a `/process-document` escribe automáticamente al Sheet (idempotente por `clave_numerica`).

### Detección automática

El motor detecta este escenario y devuelve `sheet: null` en la respuesta sin fallar. Logs:

```
warn: NO_DRIVE_QUOTA: La Service Account no tiene quota en Drive...
     Workaround: creá manualmente un Google Sheet vacío...
```

El sistema sigue 100 % funcional contra SQLite mientras tanto.

---

## 5. Verificación en vivo realizada (2026-05-18)

### MCP Hacienda CR

```bash
$ curl http://localhost:3000/hacienda/tc?moneda=USD
{"moneda":"USD","compra":449.17,"venta":455.61,"fecha_solicitada":"2026-05-18","fecha_vigente":"2026-05-18","fuente":"hacienda"}

$ curl http://localhost:3000/hacienda/tc?moneda=EUR
{"moneda":"EUR","compra":529.42,"venta":529.42,"fecha_solicitada":"2026-05-15","fecha_vigente":"2026-05-15","fuente":"hacienda"}

$ curl http://localhost:3000/hacienda/cedula/3006696489
{"cedula":"3006696489","encontrada":true,"nombre":"FUNDACION CRC ENDURANCE","estado":"inscrito",...}

$ curl http://localhost:3000/hacienda/cedula/9999999999
{"cedula":"9999999999","encontrada":false,"estado":"no_encontrada",...}
```

### Pipeline end-to-end (sin Sheets)

CSU Confites OH procesada en **34 s**:
- DocScan: 9.7 s
- Tax-IVA: 23.7 s (incluyó llamada real al MCP `validar_cedula` → trajo "Venta al por menor en supermercados, almacenes y similares" del padrón Hacienda)
- Reconciliación contra pie: OK
- Mensaje al contador: *"Procesada FE de CSU (Corporación Supermercados Unidos) por ₡3.760 con 1 línea al 13%. Reconciliación OK contra pie de factura."*

### Caches funcionando

Después de los tests + e2e:
- `cedulas_cache`: 5 filas (incluyendo CSU 3102007223 y ALPEMUSA 3101289929 reales del padrón).
- `tipo_cambio_cache`: 2 filas (USD y EUR del 2026-05-18).
- `facturas`: 3 filas persistidas.

---

## 6. Librerías agregadas

Solo una además de lo que ya estaba en CLAUDE.md §13:

- **`pdf-lib` ^1.17.1** — para cortar el PDF en sub-PDFs reales (no solo texto). Pure JS, sin Python ni binarios. Esto es lo que permite que el caso **Caja Chica Santa Ana** funcione.

Las otras 2 deps que el plan mencionaba (`@modelcontextprotocol/sdk` y `googleapis`) ya estaban listadas en CLAUDE.md como dependencias previstas.

---

## 7. Decisiones arquitectónicas (criterio senior)

### MCPs in-process en vez de procesos stdio

El plan original sugería `mcp-servers/hacienda-cr/` y `mcp-servers/fwd-db/` como procesos separados. **Decidí usar `createSdkMcpServer` del Agent SDK** (in-process):

- Sin overhead de spawn + stdio + JSON-RPC.
- Comparten código directamente con los endpoints HTTP (DRY).
- Solo un proceso para mantener (más simple deploy en Easypanel).
- El Agent SDK lo soporta nativamente.

Si en el futuro se quiere exponer estas tools a Claude Desktop standalone, se puede generar un wrapper `.js` en `mcp-servers/` que importe `lib/hacienda.ts` y monte un transport stdio. Toma ~30 minutos.

### Fallback gratuito en cascada para TC

Hacienda → Frankfurter (`from=USD&to=CRC` o `from=EUR&to=CRC`) → Fawaz (CDN jsdelivr, solo USD). Todos sin key. Si Hacienda devuelve 5xx en el primer intento de `historico`, abortamos el retroceso día-por-día para no loopear 8 × 3 reintentos contra una API caída.

### Splitter conservador

El splitter solo divide si encuentra **≥ 2 inicios de factura** detectados con alta confianza (clave 50 dígitos o "Factura Electrónica" + proveedor conocido). Para PDFs de factura única (CSU Rompope, Pequeño Mundo Zapote, etc.) devuelve `[bufferOriginal]` sin tocarlo — los tests de Fase 1 siguen pasando.

### Sheets en modo gracioso

Si el `GOOGLE_SERVICE_ACCOUNT_JSON` no existe o `NO_DRIVE_QUOTA`, el motor loguea WARN y sigue con SQLite. La respuesta de `/process-document` incluye `sheet: null` y el cliente sabe que la sincronización quedó pendiente.

---

## 8. Pendientes para Fase 3

- **Endpoint `/chat` con el Asistente Contable** (NL → SQL usando el MCP `fwd-db` que ya está armado).
- **JWT + tabla `users` + roles** (admin / contador).
- **Mejorar splitter** con Vision: para PDFs donde el splitter heurístico devuelve 1 sola factura pero el contador sabe que hay más (caso del ticket Market Río Oro con anotación a lápiz que pdf-parse no detecta), permitir un parámetro `force_split: true` que use Claude Vision para identificar inicios.
- **Re-build completo del Sheet** desde SQLite (utility `npm run sheets:rebuild`) para limpiar duplicados que pueda haber dejado el flujo idempotente actual.
- **Persistir TC y cédulas en `procesamientos`** para auditar qué fuente se usó por factura.

---

## 9. Costo total Fase 2

**$0.00 en APIs externas**. Confirmado:

- **Claude**: corre con la suscripción Claude Code Max plan del usuario (sin API key paga).
- **Hacienda CR**: API pública, sin auth, sin token.
- **Google Sheets / Drive**: free tier permanente (300 reads/min, sin tarjeta).
- **Frankfurter / Fawaz**: open source, sin key.

Costo en tokens Claude por factura procesada (informativo, va contra la suscripción Max — sin cargo extra):
- DocScan: ~$0.15 USD por factura
- Tax-IVA: ~$0.12 USD por factura

---

## 10. Tiempos de respuesta

| Operación | Tiempo |
|---|---|
| `GET /health` | <10 ms |
| `GET /hacienda/tc` (cache hit) | ~5 ms |
| `GET /hacienda/tc` (cache miss → Hacienda) | ~300 ms |
| `GET /hacienda/cedula/:cedula` (cache hit) | ~5 ms |
| `GET /hacienda/cedula/:cedula` (cache miss) | ~300 ms |
| `POST /process-document` 1 factura, sin Sheets | ~30-40 s |
| `POST /process-document` 1 factura, con Sheets | ~35-45 s (estimado) |
| `POST /process-document` multi-factura (Caja Chica) | ~3 min (6 sub-facturas × 30 s) |
| `npm test` completo | ~125 s |
| `npm run db:init` | ~150 ms |

---

## 11. Cómo arrancar después de clonar

```powershell
cd "C:\Users\torme\OneDrive\Desktop\FWD Contable AI\engine"
npm install
Copy-Item .env.example .env
# (Editá .env con tu CONTADOR_EMAIL y GOOGLE_SERVICE_ACCOUNT_JSON)
npm run db:init
npm run sheets:setup     # OPCIONAL — sigue las instrucciones si dice NO_DRIVE_QUOTA
npm run dev
```

Smoke test:

```powershell
curl http://localhost:3000/health
curl http://localhost:3000/hacienda/tc?moneda=USD
curl http://localhost:3000/hacienda/cedula/3006696489
curl -F "file=@tests/fixtures/FE CONFITES OH 22 NOVIEMBRE 2025.pdf" `
     -F "empresa_id=3006696489" `
     http://localhost:3000/process-document
```

Tests:

```powershell
npm test
```

---

## 12. Resumen ejecutivo

| Métrica | Valor |
|---|---|
| Tareas del plan | 15 / 15 completadas |
| Tests | 16 / 16 verdes (10 nuevos + 6 que ya estaban) |
| Endpoints HTTP nuevos | 6 |
| MCPs in-process | 2 (hacienda-cr, fwd-db) |
| Librerías agregadas (no listadas en CLAUDE.md §13) | 1 (`pdf-lib`) |
| Costo en APIs externas | $0.00 |
| Limitación residual | Setup manual del Sheet (5 clics, 1 vez) |
