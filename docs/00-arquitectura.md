# Arquitectura — FWD Contable AI

## Visión de 30 segundos

Tres capas con responsabilidades quirúrgicas. Cada capa hace lo que mejor hace.

```
┌─────────────────────────────────────────────────────────────────┐
│  CAPA 1 — UX / Orquestador                                      │
│  n8n self-hosted en Easypanel                                   │
│  onlyautotask-n8n.tuoaro.easypanel.host                         │
│                                                                 │
│  Triggers:                                                      │
│   • Form web "Subir factura"  (PDF/XML upload)                  │
│   • Chat "Preguntar al asistente"                               │
│   • Schedule diario          (pull XMLs de Hacienda)            │
│   • WhatsApp Business        (fase 2)                           │
│                                                                 │
│  n8n NO razona. Solo dispara webhooks.                          │
└────────────────────────────┬────────────────────────────────────┘
                             │ HTTP (JSON)
                             ▼
┌─────────────────────────────────────────────────────────────────┐
│  CAPA 2 — Motor de IA                                           │
│  Node.js 24 + Express + Claude Agent SDK                        │
│  Corre local en PC del dev (Fase 1-4) → Easypanel (Fase 5)      │
│                                                                 │
│  Endpoints REST:                                                │
│   POST /process-document  → spawn agente DocScan + Tax-IVA      │
│   POST /chat              → spawn agente Asistente Contable     │
│   GET  /health                                                  │
│                                                                 │
│  Sub-agentes (uno por skill):                                   │
│   • DocScan           (skills/docscan.md)                       │
│   • TaxIVA            (skills/tax-iva.md)                       │
│   • AsistenteContable (skills/asistente-contable.md)            │
│                                                                 │
│  Cumple el "Node.js + Express" del catálogo del taller.         │
└────────────────────────────┬────────────────────────────────────┘
                             │ MCP (stdio / sse)
                             ▼
┌─────────────────────────────────────────────────────────────────┐
│  CAPA 3 — Tools y Storage                                       │
│                                                                 │
│  MCP servers custom:                                            │
│   • mcp-bccr          → tipo de cambio del día (BCCR)           │
│   • mcp-hacienda-cr   → padrón cédulas + estado factura         │
│   • mcp-fwd-db        → queries SQL (lectura/escritura SQLite)  │
│                                                                 │
│  MCP server oficial:                                            │
│   • google-sheets-mcp → escribir machote Forward CR             │
│                                                                 │
│  Storages:                                                      │
│   • Google Sheets (vista contador)                              │
│   • SQLite        (memoria del Asistente)                       │
│   • Filesystem    (PDFs/XMLs archivados)                        │
└─────────────────────────────────────────────────────────────────┘
```

## Flujo "Subir factura" (caso típico)

1. Contador entra a `https://onlyautotask-n8n.tuoaro.easypanel.host/form/subir-factura`.
2. Sube un PDF.
3. n8n recibe el archivo y hace `POST http://localhost:3000/process-document` al motor.
4. Motor invoca al sub-agente **DocScan**:
   - Lee el PDF (visión + texto).
   - Carga `skills/docscan.md` como contexto.
   - Identifica el dialecto (CSU, ALPEMUSA, PriceSmart, El Rey, Market Río Oro).
   - Extrae JSON estructurado matching `factura.schema.json`.
5. Motor invoca al sub-agente **Tax-IVA** con ese JSON:
   - Carga `skills/tax-iva.md` como contexto.
   - Si moneda ≠ CRC → llama MCP `bccr.obtener_tipo_cambio`.
   - Llama MCP `hacienda-cr.validar_cedula` (proveedor).
   - Clasifica tarifa por línea (marcada vs inferida).
   - Reconcilia contra el pie de la factura.
   - Escribe a Google Sheets (vía MCP) y SQLite (vía MCP `fwd-db`).
6. Motor responde a n8n con el resumen.
7. n8n muestra al contador: "✅ Factura procesada. Total ₡25.970,00 (2 líneas, IVA mixto 1%+13%). Revisá el Sheet."

## Flujo "Preguntar al asistente"

1. Contador escribe en el chat de n8n: "¿cuánto se gastó este mes?".
2. n8n hace `POST /chat` al motor con `{user_id, mensaje}`.
3. Motor invoca al sub-agente **Asistente Contable**:
   - Carga `skills/asistente-contable.md`.
   - Carga las últimas 10 entradas de `chat_history` para contexto.
   - Genera SQL → ejecuta vía MCP `fwd-db.query`.
   - Formatea respuesta en español natural.
   - Guarda intercambio en `chat_history`.
4. n8n muestra la respuesta al contador.

## Por qué este diseño

| Decisión | Razón |
|---|---|
| n8n para UX | Vos ya lo tenés, el contador no toca código, automatizaciones gratis |
| Claude Agent SDK | Skills nativas + MCPs nativos + sub-agentes nativos + auth con Claude Code (cero costo de API) |
| Node.js + Express en motor | Cumple el stack del catálogo del taller; el SDK está en TypeScript |
| MCPs separados | Reutilizables fuera del proyecto, debugging independiente |
| SQLite (no Postgres) | Cero ops, cero servidor adicional. Para 1000-10000 facturas es ideal |
| Google Sheets como UI | El contador YA sabe usarlo. Cero curva de aprendizaje |
| Agente, no regex | Heterogeneidad de 5 dialectos + OCR degradado. Regex sería frágil |

## Roadmap de fases

| Fase | Output | Quién |
|---|---|---|
| **0** ✅ | Estructura repo, skills, schemas, README | Yo |
| **1** ⏳ | Motor Node.js + DocScan + Tax-IVA funcionando con los 4 PDFs golden | Yo |
| **2** | MCPs (BCCR, Hacienda, fwd-db) + Service Account Google + Sheet creado | Yo + vos (credenciales) |
| **3** | Asistente Contable con DB poblada + endpoint /chat | Yo |
| **4** | Workflows n8n .json listos para importar | Yo entrego, vos importás |
| **5** | Pulido UX para contador + deploy motor a Easypanel | Yo |
