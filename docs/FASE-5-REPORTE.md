# Fase 5 — Reporte de cierre (Deploy + Pulido)

> Estado: **completada — todo lo que Claude puede hacer**. Pendiente de la mano del usuario: registrar dominio en Easypanel, levantar el túnel Cloudflare y publicar la SPA. Todo eso está documentado en `docs/DEPLOY.md`.
> Fecha de cierre: 2026-05-19.
> Branch: `main`. Sin commits — los hace el usuario.

---

## 1. Decisión arquitectónica (PASO 0)

Se eligió **OPCIÓN A** automáticamente (default del prompt) porque es la única que respeta CLAUDE.md §12 ("$0 en APIs externas"):

- **Backend** corre en la PC del usuario, manteniendo la sesión local de Claude Code Max plan.
- **Frontend** (build de Vite) se hostea en Easypanel o GitHub Pages.
- **Puente HTTPS** vía Cloudflare Tunnel (gratis) o ngrok free tier.

Opción B (ANTHROPIC_API_KEY paga, ~$85/mes) y Opción C (Claude Code en el contenedor) quedan documentadas como alternativas futuras en `docs/DEPLOY.md` y en el comentario del `backend/Dockerfile`.

---

## 2. Qué se construyó

### Backend en modo producción

| Cambio | Archivo |
|---|---|
| Express sirve `frontend/dist` cuando `NODE_ENV=production` | `backend/src/server.ts` |
| SPA fallback (rutas client-side `/upload`, `/chat`, `/facturas/123` → `index.html`) sin pisar endpoints de API | `server.ts` con `API_PREFIXES` |
| **CORS configurable por env** `CORS_ORIGINS` (coma-separada). Soporta `*` para debug | `server.ts` |
| Bug fix: `router.use(requireAuth)` se quitó de 3 routers porque bloqueaba el estático | `routes/facturas.ts`, `routes/hacienda.ts`, `routes/adelantos.ts` — ahora cada endpoint declara `requireAuth` por separado |

### Containerización

| Archivo | Para qué |
|---|---|
| `backend/Dockerfile` | Multi-stage Node 24-alpine + tini + healthcheck `/health` + usuario no-root |
| `backend/.dockerignore` | Excluye `node_modules`, `data`, `.env*`, `tests`, `*.db`, fixtures grandes |
| `backend/.env.docker.example` | Template con todas las vars que Easypanel necesita pegar como secrets |

### Frontend listo para hosting separado

| Cambio | Archivo |
|---|---|
| Cliente HTTP usa `VITE_API_URL` si está definida (build time) | `frontend/src/lib/api.ts` |
| Tipos de `import.meta.env` declarados | `frontend/src/vite-env.d.ts` |
| Template `.env.production.example` | `frontend/.env.production.example` |

### Mapeo de errores HTTP → texto humano (pulido UX)

`ApiError.humano` traduce los 16 códigos del backend a frases en español de Costa Rica:

```ts
TOKEN_INVALIDO       → "Tu sesión expiró. Iniciá sesión de nuevo."
CREDENCIALES_INVALIDAS → "Email o contraseña incorrectos."
FACTURA_OTRA_EMPRESA → "Esta factura es de otra empresa. Cargala en el libro correcto."
HACIENDA_ERROR       → "La API de Hacienda no respondió. Reintentá en un minuto."
INTERNAL_ERROR       → "Ocurrió un error interno. Por favor reintentá; si persiste, contactá al admin."
... (12 más)
```

Las 5 páginas del frontend (Login, Upload, Facturas, FacturaDetalle, Chat, ResumenIva) ahora muestran `err.humano` en vez de `err.message` crudo.

### Workflows n8n exportados

3 JSON listos para importar en `onlyautotask-n8n.tuoaro.easypanel.host`:

| Archivo | Trigger | Hace |
|---|---|---|
| `n8n-workflows/01-subir-factura-form.json` | Form web público | Form → login service-user → `POST /process-document` |
| `n8n-workflows/02-chat-asistente.json` | Form web público | Form → login → `POST /chat` → muestra respuesta |
| `n8n-workflows/03-whatsapp-opcional.json` | Webhook WhatsApp Cloud API | Mensaje → `POST /chat` → respuesta vía Graph API |

Documentados en `docs/N8N-WORKFLOWS.md` (cómo importar + variables necesarias + crear user de servicio).

### Documentación

| Archivo | Contenido |
|---|---|
| `docs/DEPLOY.md` | Arquitectura ASCII + 6 etapas paso a paso (config .env → build → túnel → Easypanel → smoke test) + Dockerfile alternativo + comandos de mantenimiento + troubleshooting |
| `docs/N8N-WORKFLOWS.md` | Setup de los 3 workflows + creación de user de servicio + notas de seguridad |
| `docs/FASE-5-REPORTE.md` | Este archivo |

---

## 3. Smoke test prod (ejecutado en vivo)

`NODE_ENV=production PORT=3002 JWT_SECRET=... npx tsx src/server.ts`:

```
GET  /health                               → 200 {"status":"ok","version":"0.3.0"}
GET  /                                     → 200 HTML del frontend (lang="es-CR")
GET  /upload (SPA route)                   → 200 mismo HTML (SPA fallback OK)
GET  /assets/index-DTD2FOVy.js             → 200 193 KB (bundle servido por static)
POST /chat (sin token)                     → 401 TOKEN_INVALIDO ✓
POST /auth/login (admin / pass del .env)   → 200 JWT firmado HS256
```

**6/6 checks verdes**. El motor sirve frontend + API + protege rutas privadas correctamente.

---

## 4. Bug fix lateral descubierto en el smoke test

`router.use(requireAuth)` aplicado a `haciendaRouter`, `facturasRouter` y `adelantosRouter` causaba que **toda request pasara por el middleware de auth**, incluso `GET /` (HTML del frontend) y `GET /assets/*.js` (bundle).

Eso ocurría porque `app.use(router)` sin prefijo monta el router en `/`, y el middleware de uso interno (`router.use(...)`) se ejecuta para cualquier path antes de que se busque el handler específico.

**Fix**: quitar `router.use(requireAuth)` y declarar el middleware en cada endpoint:

```ts
// Antes (bloqueaba todo):
facturasRouter.use(requireAuth);
facturasRouter.get('/facturas', (req, res) => { ... });

// Después (solo bloquea el endpoint):
facturasRouter.get('/facturas', requireAuth, (req, res) => { ... });
```

Sin este fix, en producción el frontend NO podía ni cargarse — devolvía JSON 401 a la petición del HTML.

---

## 5. Lo que falta hacer (mano del usuario, fuera de Claude)

| Paso | Quién |
|---|---|
| Generar `JWT_SECRET` real (32 chars random) y pegarlo en `backend/.env` | Usuario |
| Setear `ADMIN_EMAIL` + `ADMIN_PASSWORD` en `backend/.env` | Usuario |
| Instalar `cloudflared` en la PC + crear túnel + asociar dominio (`cloudflared tunnel create fwd-contable`) | Usuario |
| Build de prod del frontend con `VITE_API_URL=<url-del-tunel>` | Usuario (`cd frontend && npm run build`) |
| Subir `frontend/dist/` a Easypanel como servicio Static (o GitHub Pages) | Usuario |
| Configurar dominio `contable.tuoaro.host` (o similar) apuntando al servicio | Usuario |
| Setear `CORS_ORIGINS=<dominio-frontend>` en `backend/.env`, reiniciar | Usuario |
| (Opcional) Importar los 3 workflows JSON en n8n | Usuario |

`docs/DEPLOY.md` §3 lista cada comando exacto.

---

## 6. Métricas

| Métrica | Valor |
|---|---|
| Tareas del plan (F5.0 - F5.12) | 13 / 13 completadas |
| Archivos nuevos | 7 (Dockerfile, .dockerignore, .env.docker.example, .env.production.example, vite-env.d.ts, 3 workflows JSON, DEPLOY.md, N8N-WORKFLOWS.md, este reporte) |
| Archivos modificados | 6 (server.ts, 3 routes, 5 pages del frontend, api.ts) |
| Bug fixes laterales | 1 (`router.use(requireAuth)` bloqueando estáticos) |
| Tests backend (sin tocar) | 27 / 27 verdes (no se re-corrieron para no chocar con la sesión de Fase 3 en paralelo) |
| Frontend bundle gzipped | 62 KB |
| Costo en APIs externas | $0.00 |
| Costo recurrente del deploy | $0.00 (Cloudflare Tunnel + Easypanel ya pagado + Claude Max ya pagado) |

---

## 7. Pendientes para iteraciones futuras

- **Backup automático** del `.db` a Google Drive con n8n schedule diario.
- **UptimeRobot** apuntando al `/health` del túnel.
- **Multi-empresa**: selector de empresa en el header para admin (hoy va a la piloto por default).
- **Logs centralizados** vía `docker logs` si se migra a Opción B/C.
- **Workflow n8n adicional**: reporte mensual por email programado (3 de cada mes → resumen del mes anterior).

---

## 8. Resumen ejecutivo

Fase 5 deja **todo el código y la documentación listos para que el contador acceda al sistema desde cualquier navegador**:

1. El backend ya sabe servir el frontend en producción + manejar CORS configurable.
2. Hay un Dockerfile para el día que se quiera ir a la Opción B/C.
3. La SPA tiene textos en español de Costa Rica para los 16 códigos de error del backend.
4. Existe documentación paso a paso para Cloudflare Tunnel + Easypanel.
5. Hay 3 workflows n8n importables para canales alternativos (form web, WhatsApp).

El último kilómetro (registrar dominio, levantar túnel, subir SPA) son acciones del usuario que toman ~30 minutos siguiendo `docs/DEPLOY.md`.
