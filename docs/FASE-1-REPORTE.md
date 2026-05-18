# Fase 1 — Reporte de cierre

> Estado: **completada**. Fecha de cierre: 2026-05-17.
> Branch: `master`. Commits locales (sin push).

## 1. Qué se construyó

Un motor Node.js + TypeScript funcional que:

1. **Recibe un PDF o XML** vía `POST /process-document` (multipart/form-data) con el campo `empresa_id`.
2. **Lo extrae con DocScan** (sub-agente Claude que aplica las reglas por dialecto del skill `engine/skills/docscan.md`).
3. **Lo enriquece con Tax-IVA** (sub-agente Claude que infiere tarifa por línea, calcula base e IVA, reconcilia y persiste).
4. **Valida** el JSON contra `engine/schemas/factura.schema.json` con Ajv 2020.
5. **Persiste** la factura en SQLite (tabla `facturas` + `lineas_factura`), incluyendo proveedor en `proveedores`.
6. **Devuelve** `{ factura, resumen }` al cliente.

### Endpoints implementados

| Método | Path | Hace |
|---|---|---|
| GET | `/health` | `{ status, version, db }` |
| POST | `/process-document` | DocScan + Tax-IVA + persistir |

### Archivos creados en Fase 1

```
engine/
├── package.json                      Deps de CLAUDE.md §13 + types
├── vitest.config.ts                  Config de tests
├── .env                              Copia de .env.example
├── src/
│   ├── server.ts                     Express + CORS + middlewares
│   ├── config.ts                     Loader .env con zod
│   ├── lib/
│   │   ├── db.ts                     SQLite WAL singleton
│   │   ├── db-init.ts                Script `npm run db:init`
│   │   ├── logger.ts                 Winston (dev pretty / prod JSON)
│   │   ├── errors.ts                 Clases tipadas (FacturaInvalida, etc.)
│   │   ├── validator.ts              Ajv 2020 + factura.schema.json
│   │   ├── pdf-extract.ts            pdf-parse → texto + flag escaneado
│   │   └── xml-parse.ts              fast-xml-parser → FE/TE/NC/ND
│   ├── agents/
│   │   ├── claude.ts                 Factory de sub-agente con Agent SDK
│   │   ├── docscan.ts                Pipeline PDF/XML → JSON factura
│   │   └── tax-iva.ts                Enriquecimiento + persistencia
│   ├── routes/
│   │   ├── health.ts
│   │   └── process-document.ts
│   └── types/factura.ts              Tipos TS espejando el schema
├── tests/
│   ├── helpers.ts
│   ├── docscan.test.ts               4 PDFs golden (1 skip Caja Chica)
│   └── reconciliation.test.ts        3 unit tests de reconcileFactura
└── data/                             SQLite + uploads (gitignored)
```

## 2. Cómo arrancar

```powershell
cd "C:\Users\torme\OneDrive\Desktop\FWD Contable AI\engine"
npm install
Copy-Item .env.example .env
npm run db:init
npm run dev
```

En otro terminal:

```powershell
curl http://localhost:3000/health
# {"status":"ok","version":"0.1.0","db":"connected"}

# Procesar una factura (CSU Rompope golden)
curl -F "file=@tests/fixtures/50626112500310200722315100046010000285222100000000.pdf" `
     -F "empresa_id=3006696489" `
     http://localhost:3000/process-document
```

Tests:

```powershell
npm test
```

## 3. Resultados de los tests

`npm test` corre en **~65 s** total:

| Suite | Tests | Pasados | Skip | Tiempo |
|---|---|---|---|---|
| `tests/reconciliation.test.ts` | 3 | 3 | 0 | 2 ms |
| `tests/docscan.test.ts` | 4 | 3 | 1 | ~65 s |

Detalle por golden:

- **CSU Rompope** (₡25.970, tarifas 1 % + 13 %): pasa en **~29 s**.
- **CSU Confites OH** (₡3.760, tarifa 13 %): pasa en **~18 s**.
- **Pequeño Mundo Zapote** (₡6.900, tarifa marcada 13 %): pasa en **~18 s**.
- **Caja Chica Santa Ana** (10 páginas, multi-factura): `it.skip` — splitter previo pendiente para Fase 2+.

## 4. Tiempos aproximados del pipeline

Medidos con `claude-sonnet-4-5` (default del SDK, autenticado vía Claude Code Max plan):

| Paso | Tiempo |
|---|---|
| Boot del motor (`npm run dev`) | ~2 s |
| `GET /health` | <10 ms |
| `extractFactura` (DocScan, PDF nativo 1 página) | 8–12 s |
| `enrichFactura` (Tax-IVA, 1-2 líneas) | 14–20 s |
| Pipeline completo `/process-document` | **20–30 s por factura simple** |

Costo por factura (informativo, va contra la suscripción Max — sin cargo extra):
DocScan ~$0.05 USD, Tax-IVA ~$0.06 USD.

## 5. Decisiones de diseño relevantes

- **`outputFormat: { type: 'json_schema', schema }`** en la llamada al SDK fuerza salida estructurada. Si el modelo igual aplana o devuelve texto, hay un fallback: `extractJsonFromText` busca el primer bloque JSON balanceado.
- **`coerceFacturaEnvelope`** en `tax-iva.ts`: si el modelo devuelve la factura interna sin envelope (`{ clave_numerica, ... }` en vez de `{ fuente, factura: { clave_numerica, ... } }`), reempaquetamos heredando los campos faltantes del input de DocScan. Más robusto que pelear con el prompt.
- **Sub-agente sin herramientas**: `tools: []`, `mcpServers: {}`, `settingSources: []`, `persistSession: false`. El agente sólo razona sobre el prompt — no toca filesystem, ni MCP, ni CLAUDE.md ajenos. Aislamiento total.
- **`permissionMode: 'bypassPermissions'`** + `allowDangerouslySkipPermissions: true` para que las llamadas headless no pidan confirmación. Es seguro porque `tools: []` apaga todo lo peligroso.
- **Reconciliación local** (`reconcileFactura`) corre como sanity check después de Tax-IVA: si el modelo dijo OK pero los números no cuadran, lo logueamos como warn (sin tirar). Útil para detectar drift del modelo en producción.
- **NFD/NFC en fixtures**: el filesystem (OneDrive en Windows) guarda `Ñ` en NFD (`N + U+0303`). El helper `loadFixture` normaliza ambos lados antes de buscar.

## 6. Pendientes (Fase 2 en adelante)

- **MCPs custom** (`bccr`, `hacienda-cr`, `fwd-db`).
- **Google Sheets** (Service Account + escritura del machote Forward CR).
- **Splitter de PDFs multi-factura** (Caja Chica Santa Ana).
- **Vision real para PDFs escaneados** (ahora pasamos solo texto; si pdf-parse no extrae, marcamos `OCR_DEGRADADO`).
- **BCCR para tipo de cambio** USD/EUR → CRC (ahora asumimos 1).
- **Validación contra padrón Hacienda** de las cédulas de proveedor.
- **Endpoint `/chat`** (Asistente Contable) + JWT/users (Fase 3).
- **Frontend React + Vite** (Fase 4).
- **Workflows n8n** exportados (Fase 4).
- **Deploy a Easypanel** + WhatsApp (Fase 5).

## 7. Librerías agregadas o cambiadas vs CLAUDE.md §13

- **`better-sqlite3`**: subido de `^11.3.0` a `^12.10.0` porque la 11.x **no tiene binarios prebuilt para Node 24** y trataba de compilar con Python (no disponible). La 12.10.0 soporta Node 20-26 con prebuilts.
- **`@types/better-sqlite3`**: agregado como devDep (no estaba listado, pero es necesario para tipar el cliente).

No se agregó ninguna librería nueva fuera de la lista de CLAUDE.md §13.

## 8. TODOs en el código

Quedan dos `TODO(fase-1)` marcados:

- `engine/src/lib/pdf-extract.ts`: si surge un PDF escaneado en producción, agregar conversión a imagen o pasar el PDF binario como adjunto `document` al sub-agente.
- `engine/src/agents/docscan.ts`: el prompt actual procesa la primera factura si encuentra varias (caso Caja Chica). El splitter completo va en Fase 2+.

## 9. Notas para el contador

Cuando el sistema esté en producción (Fase 5):

- Si una factura aparece con fondo amarillo en el Sheet, el motor pide que la revises antes de declararla. El campo `motivo_revision` te dice por qué (cédula no encontrada, tarifa rara, OCR malo, etc.).
- El sistema confía SIEMPRE en la tarifa que marca el proveedor. Si la factura dice 1 %, el sistema escribe 1 % — aunque el producto "se vea" como 13 %. La regla es: la factura manda, vos sólo revisás.
- Por ahora el sistema procesa **una factura a la vez**. Para subir un Reintegro de Caja Chica con varios comprobantes, hay que separarlos y subirlos uno por uno hasta que terminemos la Fase 2.
