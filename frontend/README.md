# Frontend — FWD Contable AI

> **Estado**: scaffold vacío. Se llena en **Fase 4**.

Esta carpeta es el espacio reservado para el frontend del proyecto. La capa
HTTP del backend (`../backend`) ya expone los endpoints que va a consumir.

## Stack previsto (decidido en CLAUDE.md §13)

- **React** + **Vite** (sin Next.js, sin SSR).
- **TypeScript** (consistente con el backend).
- **react-router-dom** para routing client-side.
- **`fetch()`** plano contra `http://localhost:3000` (motor backend).
- Sin Tailwind / MUI / AntD. CSS plano hasta que el contador pida lo contrario.

## Páginas mínimas que la Fase 4 va a construir

1. `/login` — JWT auth (Fase 3 expone el endpoint).
2. `/upload` — Subir factura (PDF o XML) — consume `POST /process-document`.
3. `/factura/:id` — Detalle de factura procesada — consume `GET /facturas/:id`.
4. `/resumen-iva` — Tabla de tarifas IVA — consume `GET /facturas?empresa_id=...`.
5. `/chat` — Asistente Contable (NL → SQL) — consume `POST /chat` (Fase 3).
6. `/admin` — Panel admin de usuarios y empresas.

## Comandos previstos para Fase 4

```powershell
cd frontend
npm create vite@latest . -- --template react-ts
npm install react-router-dom
npm run dev    # arranca en http://localhost:5173 (el backend acepta CORS desde ahí)
```

## Endpoints del backend que están listos para consumir

| Endpoint | Para qué |
|---|---|
| `GET /health` | health check |
| `POST /process-document` | sube PDF/XML, recibe `{ factura, resumen, sheet }` |
| `GET /facturas?empresa_id=X&mes=YYYY-MM` | lista facturas |
| `GET /facturas/:id` | detalle (factura + líneas) |
| `GET /hacienda/tc?moneda=USD\|EUR&fecha=YYYY-MM-DD` | tipo de cambio |
| `GET /hacienda/cedula/:cedula` | padrón de contribuyentes |
| `POST /adelantos` | crea adelanto de caja chica |
| `GET /caja-chica/saldo?empresa_id=X` | saldo |

## Hasta Fase 4

Esta carpeta queda con este `README.md` solo. No instalar nada todavía — el
backend opera de forma independiente y los tests usan curls/fetches contra
`http://localhost:3000` directamente.
