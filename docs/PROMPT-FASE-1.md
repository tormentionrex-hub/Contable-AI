# PROMPT — Fase 1: Motor Node.js + DocScan + Tax-IVA

> **Cómo usar este archivo**: copiá el bloque "PROMPT PARA CLAUDE CODE" entero y pegalo en una sesión nueva de Claude Code abierta en la carpeta `C:\Users\torme\OneDrive\Desktop\FWD Contable AI`. Claude Code va a leer automáticamente `CLAUDE.md` antes de actuar, así que tiene todo el contexto.

---

## PROMPT PARA CLAUDE CODE

```
Tu tarea es ejecutar la Fase 1 completa del proyecto FWD Contable AI. Antes de tocar nada, leé el archivo CLAUDE.md en la raíz del proyecto — contiene TODO el contexto (arquitectura, restricciones, stack, datos reales, decisiones tomadas). NO me preguntes cosas que ya están en CLAUDE.md.

Si en algún momento dudás sobre algo que NO esté en CLAUDE.md, asumí razonablemente y dejá un comentario `// TODO(fase-1): <pregunta>` en el código en lugar de bloquearte preguntando.

OBJETIVO DE FASE 1

Construir el motor Node.js que procesa una factura (PDF o XML) usando 2 sub-agentes Claude (DocScan y Tax-IVA), valida el output contra el JSON schema, lo persiste en SQLite, y devuelve el JSON al cliente. SIN escribir a Google Sheets todavía (eso es Fase 2). SIN frontend todavía (eso es Fase 4). SIN MCPs externos todavía (eso es Fase 2).

CRITERIOS DE ACEPTACIÓN

Al terminar, los siguientes 6 comandos deben funcionar sin errores:

1. cd "C:\Users\torme\OneDrive\Desktop\FWD Contable AI\backend" ; npm install
2. Copy-Item .env.example .env
3. npm run db:init
   (crea backend/data/fwd-contable.db con todas las tablas, vistas e inserta FUNDACION CRC Endurance)
4. npm run dev
   (arranca Express en http://localhost:3000 sin errores)
5. curl http://localhost:3000/health
   (devuelve { "status": "ok", "version": "0.1.0", "db": "connected" })
6. npm test
   (corre los tests con los 4 PDFs golden y todos pasan)

RESTRICCIONES DURAS (de CLAUDE.md)

- Cero Python, cero binarios externos, cero Tesseract.
- Cero `git push`. Solo `git init` y `git commit` locales. Si necesitás commitear, usá el formato visto en commits previos.
- Cero librerías fuera de las listadas en CLAUDE.md sección 13. Si CREÉS que necesitás una más, agregala a la lista y comentá por qué.
- Cero modificación de archivos en `.gitignore` (datos locales, .env, credenciales).
- Los skills en backend/skills/*.md son sagrados. NO los reescribas. Solo los cargás como contexto del sub-agente.

PLAN DE EJECUCIÓN PASO A PASO

Te recomiendo seguir este orden. Marcá cada paso con TodoWrite.

PASO 1 — Inicializar package.json y deps
- cd backend
- Actualizá package.json para incluir TODAS las dependencias listadas en CLAUDE.md sección 13.
- npm install (debe completar sin errores).
- Si alguna dep falla, ajustá la versión a la latest estable y reintentá.

PASO 2 — Estructura de carpetas
Crear:
  backend/src/server.ts
  backend/src/config.ts
  backend/src/lib/db.ts
  backend/src/lib/logger.ts
  backend/src/lib/pdf-extract.ts
  backend/src/lib/xml-parse.ts
  backend/src/lib/validator.ts
  backend/src/lib/db-init.ts
  backend/src/agents/claude.ts
  backend/src/agents/docscan.ts
  backend/src/agents/tax-iva.ts
  backend/src/routes/health.ts
  backend/src/routes/process-document.ts
  backend/src/types/factura.ts
  backend/tests/docscan.test.ts
  backend/tests/reconciliation.test.ts
  backend/data/.gitkeep
  backend/data/uploads/.gitkeep

PASO 3 — config.ts y logger.ts
- config.ts: carga .env con dotenv, valida con zod (PORT, NODE_ENV, DB_PATH, CLAUDE_AUTH_MODE, STORAGE_PATH, LOG_LEVEL). Exporta `config` tipado.
- logger.ts: winston con format JSON en prod, pretty en dev. Niveles: error, warn, info, debug.

PASO 4 — db.ts y db-init.ts
- db.ts: abre backend/data/fwd-contable.db con better-sqlite3 con `WAL` y `foreign_keys=ON`. Exporta `db` singleton.
- db-init.ts: lee backend/schemas/db.sql y lo ejecuta contra db. Script invocable con `npm run db:init`.
- Agregá script `"db:init": "tsx src/lib/db-init.ts"` en package.json.

PASO 5 — validator.ts
- Cargá backend/schemas/factura.schema.json con ajv (con ajv-formats para validar `date`).
- Exportá `validateFactura(json)` que devuelve { valid: boolean, errors: ErrorObject[] | null }.

PASO 6 — pdf-extract.ts y xml-parse.ts
- pdf-extract.ts: usa pdf-parse para extraer texto de un Buffer de PDF. Si el PDF es escaneado (texto muy corto o vacío), retorná `{ text: '', isScanned: true, base64Pages: string[] }` con cada página convertida a base64 PNG (esto último: SI pdf-parse no lo hace, dejá `base64Pages: []` y un comentario indicando que en Fase 1 los escaneados se pasan directamente a Claude Vision con el PDF original como input).
- xml-parse.ts: usa fast-xml-parser. Función `parseHaciendaXML(xmlString)` que devuelve un objeto JS estructurado con clave, consecutivo, líneas, totales, según el esquema de FE 4.3/4.4.

PASO 7 — agents/claude.ts (cliente compartido)
- Importá `@anthropic-ai/claude-agent-sdk`.
- Exportá una función `createSubagent({ name, skillPath, model? })` que:
  - Lee el archivo de skill (e.g. backend/skills/docscan.md) como string.
  - Inicializa un cliente del Agent SDK autenticado vía Claude Code (sin API key — debe detectar automáticamente la sesión Claude Code; consultá la doc del SDK si dudás).
  - Devuelve una función `run(input: any): Promise<any>` que envía el input al sub-agente con el skill como system prompt y devuelve el JSON parseado.
- Modelo por default: el más capaz disponible (claude-sonnet-4 o equivalente). Si no estás seguro, dejá undefined y que el SDK use el default.

PASO 8 — agents/docscan.ts
- Importa createSubagent y crea `docscanAgent` con skill `backend/skills/docscan.md`.
- Exportá `extractFactura({ buffer, mimeType, filename }): Promise<FacturaSchemaJson>`.
- Lógica:
  1. Si mimeType es 'application/xml' o 'text/xml': parsea con xml-parse.ts y pasalo al agente como input estructurado.
  2. Si mimeType es 'application/pdf':
     - Llamá pdf-extract.ts.
     - Si tiene texto: pasalo al agente junto con metadata (filename, fuente='pdf_nativo').
     - Si NO tiene texto (escaneado): pasale al agente el PDF completo como adjunto/imagen para que use visión.
  3. El agente devuelve JSON matching factura.schema.json.
  4. Validá con validator.ts. Si inválido, lanzá un error claro.
  5. Devolvé el JSON validado.

PASO 9 — agents/tax-iva.ts
- Importa createSubagent y crea `taxIvaAgent` con skill `backend/skills/tax-iva.md`.
- Exportá `enrichFactura({ factura, empresa_id }): Promise<{ factura: FacturaSchemaJson, resumen: { status, factura_id, tarifas_detectadas, total_crc, motivos_revision: string[], mensaje_para_contador } }>`.
- Lógica:
  1. Verificá multi-tenancy: si `factura.receptor.cedula !== empresa_id`, devolvé status='revision_humana' con motivo `FACTURA_OTRA_EMPRESA`. NO escribas a DB.
  2. Pasa el JSON de factura al agente Tax-IVA (con empresa_id incluido).
  3. El agente devuelve la factura enriquecida (con `tarifa_iva_inferida`, `iva_calculado`, `base_imponible` en cada línea) Y el resumen.
  4. Validá la factura enriquecida.
  5. EN FASE 1: persistí la factura en SQLite (tabla facturas + lineas_factura). Sin llamadas a BCCR (asumí tipo_cambio=1 para CRC). Sin llamadas a Hacienda. Sin escribir a Sheets.
  6. Devolvé { factura, resumen }.

PASO 10 — routes/health.ts
- GET /health → { status: 'ok', version: '0.1.0', db: 'connected' | 'error' }.

PASO 11 — routes/process-document.ts
- POST /process-document.
- Body: multipart/form-data con campo `file` (PDF o XML) y campo `empresa_id` (string).
- Validá empresa_id con zod (no vacío, existe en tabla empresas).
- Guardá el archivo en backend/data/uploads/<uuid>-<filename>.
- Llamá extractFactura → si falla, devolvé 422 con el detalle.
- Llamá enrichFactura → si falla, devolvé 422 con el detalle.
- Devolvé 200 con { factura, resumen }.

PASO 12 — server.ts
- Importa express, cors, multer, las rutas.
- Habilitá CORS para http://localhost:5173 (Vite default) y http://localhost:3000.
- Habilitá multer con destino backend/data/uploads/, límite 10MB por archivo.
- Montá /health y /process-document.
- Middleware de errores que devuelve JSON en español: { error: string, codigo: string, detalle?: any }.
- Logger middleware: cada request loguea método, path, status, duración.
- arrancá server en process.env.PORT || 3000.

PASO 13 — tests/docscan.test.ts
- Vitest.
- 4 test cases, uno por PDF golden en backend/tests/fixtures/:
  1. CSU Rompope (50626112500310200722315100046010000285222100000000.pdf):
     - factura.totales.total_factura === 25970
     - factura.lineas.length === 2
     - Una línea con tarifa_iva_inferida === 1 (SALS CRI LIZ)
     - Una línea con tarifa_iva_inferida === 13 (ROMPOPE 1L)
     - factura.totales.iva_por_tarifa["1"] aproximadamente 25.05 (±0.5)
     - factura.totales.iva_por_tarifa["13"] aproximadamente 2696.64 (±1)
  2. CSU Confites OH (FE CONFITES OH 22 NOVIEMBRE 2025.pdf):
     - total_factura === 3760
     - 1 línea con tarifa_iva_inferida === 13
  3. Pequeño Mundo Zapote (FE PEQUEÑO MUNDO2  CC MAYO 2025.pdf):
     - total_factura === 6900
     - 1 línea, tarifa_iva_marcada === 13, tarifa_iva_inferida === 13
     - factura.proveedor.nombre incluye "ALPEMUSA" o "Pequeño Mundo" (case insensitive)
  4. Caja Chica Santa Ana (Caja Chica Santa Ana Julio 2024.pdf, 10 páginas):
     - Para Fase 1, este PDF puede tratarse como UN documento (multi-factura) o como input que el agente debe rechazar pidiendo que se separen. Documentar la decisión y dejar el test en SKIP con un comentario si no es factible en Fase 1.
- Tolerancia: usá funciones helper para comparar floats con tolerancia.
- Tests deben correr con `npm test` y completar en menos de 60 segundos cada uno.

PASO 14 — tests/reconciliation.test.ts
- Unit test para la lógica de reconciliación del skill Tax-IVA:
  - Input: factura con líneas + tarifas inferidas.
  - Output esperado: la suma de IVA por tarifa de las líneas coincide con totales.iva_por_tarifa del pie.
  - Test con tolerancia ±max(1, total*0.005).

PASO 15 — Validación final
- Corré los 6 comandos de los CRITERIOS DE ACEPTACIÓN en orden. Todos deben pasar.
- Si algo falla, debuggéa hasta arreglarlo.
- Hacé `git add -A` y `git commit` local (NO push) con mensaje del estilo:
  "Fase 1: motor con DocScan y Tax-IVA, 4 PDFs golden pasando"
  Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>

PASO 16 — Reporte final
Cuando termines, generá un archivo `docs/FASE-1-REPORTE.md` con:
- Resumen de lo construido.
- Comandos para arrancar y probar.
- Lista de cosas que quedaron como TODO para fases siguientes.
- Notas sobre cualquier librería que tuviste que cambiar de versión.
- Tiempos aproximados de respuesta de cada endpoint con un PDF.

COSAS QUE QUEDAN PARA FASES SIGUIENTES (NO LAS HAGAS AHORA)

- MCPs custom (bccr, hacienda-cr, fwd-db): Fase 2.
- Service Account Google + escritura a Sheets: Fase 2.
- Endpoint /chat + Asistente Contable funcional: Fase 3.
- JWT, login, roles, users: Fase 3.
- Frontend React+Vite: Fase 4.
- Workflows n8n: Fase 4.
- WhatsApp, TTS, deploy a Easypanel: Fase 5.

ESTILO DE CÓDIGO

- TypeScript estricto (tsconfig.json ya está configurado).
- ESM imports (`import x from 'y'`).
- async/await, no callbacks.
- Errores con clases específicas (FacturaInvalidaError, ReconciliacionFallidaError, etc.) en src/lib/errors.ts.
- Logs estructurados con winston (no console.log).
- Comentarios en español cuando expliquen una decisión de negocio, en inglés cuando sean técnicos universales.
- NO subir archivos a backend/data/ al repo (ya está en .gitignore).

EMPEZÁ AHORA. No me pidas confirmación. Si algo no está en CLAUDE.md y tenés que decidir, asumí razonablemente y dejá un TODO. Al final mostrame el output de `npm test` y el resumen.
```

---

## Cómo usarlo

1. Abrí una **terminal nueva**, navegá a la carpeta del proyecto.
2. Lanzá Claude Code en esa terminal (ejecutá `claude` si tenés el CLI instalado).
3. Pegá el bloque entre las dos líneas de `PROMPT PARA CLAUDE CODE` (lo que está dentro de los ``` triple backtick).
4. Dejalo correr. Va a tardar entre 20 y 40 minutos dependiendo de cuántos golden tests le tome iterar.
5. Cuando termine, revisás `docs/FASE-1-REPORTE.md` y los archivos creados.
6. Si todo está OK, hacés tu propio `git push` al GitHub tuyo.

## Si querés iterar paso a paso en vez de un solo prompt

Cortá el prompt por PASO 1, PASO 2, etc. y pegale uno a la vez. Más control, pero más tokens consumidos en ida y vuelta. La opción de un solo prompt es la más eficiente.

## Si Claude Code se atora en algún paso

Pegale el error que vio y decile "continuá desde el paso X". Como tiene CLAUDE.md y este prompt, sabe el contexto completo.
