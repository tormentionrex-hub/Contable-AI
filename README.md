# FWD Contable AI

Sistema multiagente de contabilidad para Costa Rica.
Cliente: **FUNDACION CRC Endurance** (céd. 3-006696489).
Usuario final: contador de Forward Costa Rica.

## Qué hace

1. **DocScan** — recibe facturas (PDF nativo, PDF escaneado, XML Hacienda) y extrae la información estructurada.
2. **Tax-IVA** — clasifica cada línea según las 6 tarifas costarricenses (0/1/2/4/13/Exento), reconcilia el cálculo contra el pie de la factura y escribe en el Google Sheet "machote Forward CR".
3. **Asistente Contable** — chat en lenguaje natural sobre toda la base contable ("¿cuánto se gastó este mes?", "¿qué facturas están vencidas?").

Los tres agentes corren sobre un mismo motor y comparten storage (Google Sheets + SQLite).

## Arquitectura (3 capas)

```
n8n (UX/orquestador) ── HTTP ──▶ Motor Node.js + Express + Agent SDK ── MCP ──▶ Hacienda CR / BCCR / Sheets / SQLite
```

- **Capa 1 — n8n** (`onlyautotask-n8n.tuoaro.easypanel.host`): formularios web, chat, schedule, WhatsApp (fase 2).
- **Capa 2 — Motor** (`engine/`): Node.js + Express + Claude Agent SDK con 3 sub-agentes (uno por skill).
- **Capa 3 — Tools** (`mcp-servers/`): 4 servidores MCP custom + Google Sheets MCP oficial.

## Estructura del repo

```
engine/                  motor Node.js + Express + Agent SDK
├── src/
│   ├── agents/          sub-agentes (DocScan, TaxIVA, Asistente)
│   ├── tools/           tools internas (no MCP)
│   ├── lib/             utilidades compartidas
│   └── types/           tipos TypeScript
├── skills/              skills en markdown que cargan los agentes
├── schemas/             JSON schemas, DDL SQLite, layout Google Sheets
└── tests/fixtures/      las 4 facturas reales como golden set

mcp-servers/             servidores MCP custom
├── bccr/                tipo de cambio (sin auth)
├── hacienda-cr/         validación cédula + estado factura
└── fwd-db/              queries SQL para el Asistente

n8n-workflows/           .json listos para importar en n8n

docs/                    documentación operativa (cómo lo usa el contador)
```

## Estado actual

- ✅ Fase 0 — Estructura, skills, schemas, README
- ⏳ Fase 1 — Motor con DocScan y Tax-IVA
- ⏳ Fase 2 — MCPs + Service Account Google
- ⏳ Fase 3 — Asistente Contable
- ⏳ Fase 4 — Workflows n8n
- ⏳ Fase 5 — Pulido UX + deploy a Easypanel

## Stack

- Node.js 24 + TypeScript + Express
- `@anthropic-ai/claude-agent-sdk` (autenticado con suscripción Claude Code)
- SQLite (mejor-sqlite3) para memoria del Asistente
- Google Sheets API (Service Account)
- MCP (Model Context Protocol) para tools externos
- n8n self-hosted en Easypanel para orquestación

## Cómo arrancar (cuando esté Fase 1 lista)

```powershell
cd engine
npm install
cp .env.example .env   # editar con credenciales
npm run dev
```
