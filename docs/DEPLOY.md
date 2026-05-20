# Deploy — FWD Contable AI (Fase 5)

> Guía completa para llevar el sistema de localhost a producción accesible por el contador desde cualquier navegador.

---

## 1. Decisión arquitectónica: OPCIÓN A

De las 3 opciones documentadas en `START-FASE-5.txt`, el sistema **se desplegó en OPCIÓN A**:

- **Frontend** → hosteado en Easypanel (al lado de n8n existente) o GitHub Pages.
- **Backend** → corre en la PC del usuario (`npm run dev` o `npm start`) para mantener la sesión local de Claude Code Max plan.
- **Puente** → Cloudflare Tunnel (gratis, sin tarjeta) o ngrok free tier expone `localhost:3000` con dominio HTTPS estable.

### Por qué Opción A y no B ni C

| Opción | Costo mensual | Pro | Contra |
|---|---|---|---|
| **A — Backend en casa + frontend remoto** ✅ | **$0** | Mantiene Claude Code Max plan local; sin tokens pagos | La PC del usuario debe estar prendida cuando el contador trabaja |
| B — Todo en Easypanel + ANTHROPIC_API_KEY | ~$85/mes | Cloud-native, PC apagada | Cuesta dinero recurrente (rechazado en CLAUDE.md §12) |
| C — Easypanel + Claude Code en el contenedor | $0 (solo si Easypanel = misma máquina) | Híbrido | Requiere validar si la VPS de Easypanel y la PC del usuario son la misma; montar `~/.claude/` complejo |

CLAUDE.md §12 dice "El presupuesto en APIs externas es $0" — Opción A es la única coherente.

---

## 2. Diagrama de arquitectura

```
                     [Contador en browser]
                              │ HTTPS
                              ▼
            ┌──────────────────────────────────────┐
            │  Easypanel (VPS pública)             │
            │  https://contable.tuoaro.host        │
            │  ─────────                            │
            │  Sirve frontend estático (Vite dist) │
            │  CORS_ORIGINS al dominio del túnel    │
            └──────────────┬───────────────────────┘
                           │ fetch(VITE_API_URL)
                           │ HTTPS
                           ▼
            ┌──────────────────────────────────────┐
            │  Cloudflare Tunnel (cloudflared)     │
            │  https://contable-api.tuoaro.tunnels │
            └──────────────┬───────────────────────┘
                           │ túnel HTTPS cifrado
                           │
                           ▼
            ┌──────────────────────────────────────┐
            │  PC del usuario (Windows + Node 24)  │
            │  npm start en backend/               │
            │  Puerto 3000 → tsx src/server.ts     │
            │                                       │
            │  Usa sesión local Claude Code Max    │
            │  Lee .env con JWT_SECRET activo      │
            │  Persiste en backend/data/*.db       │
            │  Escribe Google Sheets via SA        │
            └──────────────┬───────────────────────┘
                           │ HTTPS (APIs públicas)
                           ▼
       ┌───────────────────┼─────────────────────┐
       ▼                   ▼                     ▼
  api.hacienda.go.cr   googleapis.com       Claude (Max plan)
```

---

## 3. Paso a paso del deploy

### Etapa 1 — Configurar `.env` de producción en el backend local

En tu PC, editá `backend/.env`:

```ini
NODE_ENV=production
PORT=3000

CLAUDE_AUTH_MODE=claude_code

# Generar un secreto fuerte:
#   node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"
JWT_SECRET=PEGÁ_EL_RESULTADO_ACÁ
JWT_EXPIRES_IN=8h
ADMIN_EMAIL=admin@forwardcr.com
ADMIN_PASSWORD=password-larga-y-fuerte

DB_PATH=./data/fwd-contable.db
STORAGE_PATH=./data/storage
UPLOAD_PATH=./data/uploads

HACIENDA_API_URL=https://api.hacienda.go.cr
GOOGLE_SERVICE_ACCOUNT_JSON=../credentials/google-service-account.json
GOOGLE_SHEET_ID_FUNDACION_CRC=PEGÁ_EL_ID_DEL_SHEET
CONTADOR_EMAIL=contador@forwardcr.com

# Dominio del frontend (lo definís en Etapa 4):
CORS_ORIGINS=https://contable.tuoaro.host
```

### Etapa 2 — Build de producción del frontend

```powershell
cd "C:\Users\torme\OneDrive\Desktop\FWD Contable AI\frontend"

# Si el backend va a estar en otro dominio (Etapa 3), antes definí:
echo "VITE_API_URL=https://contable-api.tuoaro.tunnels.dev" > .env.production

npm run build
# Esto genera frontend/dist/ — la SPA estática.
```

### Etapa 3 — Túnel HTTPS desde la PC

**Cloudflare Tunnel (recomendado, gratis para siempre)**:

```powershell
# Instalar cloudflared (una sola vez)
winget install --id Cloudflare.cloudflared

# Login (abre tu navegador)
cloudflared tunnel login

# Crear un túnel con nombre
cloudflared tunnel create fwd-contable

# Asociar el túnel a tu dominio:
#   Si tenés un dominio en Cloudflare (tuoaro.com):
cloudflared tunnel route dns fwd-contable contable-api.tuoaro.com

# Correr el túnel apuntando al backend local:
cloudflared tunnel --url http://localhost:3000 run fwd-contable
```

**Alternativa ngrok (free tier con dominio efímero)**:

```powershell
ngrok http 3000
# Tomá la URL ngrok-xxxx.ngrok-free.app y usala como VITE_API_URL
```

### Etapa 4 — Subir el frontend a Easypanel

1. Entrá al dashboard: `https://onlyautotask-n8n.tuoaro.easypanel.host`.
2. **+ Service** → **Static**.
3. Nombre: `contable-frontend`.
4. Source: **Upload** (subí el contenido de `frontend/dist/`) o **Git** apuntando al repo.
5. Si usás Git, comando build: `cd frontend && npm install && npm run build`. Directorio de output: `frontend/dist`.
6. Dominio: configurá `contable.tuoaro.host` (o el subdominio que prefieras).
7. **Save** → **Deploy**.

### Etapa 5 — Arrancar el backend en modo producción

En la PC del usuario:

```powershell
cd "C:\Users\torme\OneDrive\Desktop\FWD Contable AI\backend"

# Una sola vez para crear el admin del .env:
npm run db:init

# Arrancar en producción (sirve también el frontend dist local si querés):
$env:NODE_ENV='production'
npx tsx src/server.ts
```

Esperás ver:

```
info: DB inicializada {"sheet_id":"..."}
info: Admin inicial creado {"email":"admin@forwardcr.com"}
info: Motor FWD Contable AI escuchando en http://localhost:3000 {"env":"production","authEnabled":true,"corsOrigins":["https://contable.tuoaro.host"],"sirveFrontend":true}
```

### Etapa 6 — Smoke test desde el navegador

1. Abrí `https://contable.tuoaro.host` desde tu celular o cualquier red.
2. **Login** con el `ADMIN_EMAIL` + `ADMIN_PASSWORD` del `.env`.
3. **Subir factura**: arrastrá un PDF golden — el motor procesa en 25-40s.
4. **Chat**: preguntá *"¿Cuánto se gastó este mes?"* — el asistente responde.

Si los 3 pasos funcionan, el deploy está OK.

---

## 4. Alternativa: backend con Dockerfile (Opción B futura)

El repo trae un `backend/Dockerfile` multi-stage listo. Hoy NO se usa porque
Opción A va por túnel, pero queda preparado para Opción B (con `ANTHROPIC_API_KEY` paga) o Opción C (si Easypanel está en la misma máquina que el usuario).

```powershell
# Construir
cd backend
docker build -t fwd-contable-ai-backend .

# Correr (necesita .env.docker con todas las vars del .env.docker.example)
docker run --rm -p 3000:3000 `
  --env-file .env.docker `
  -v $PWD/data:/data `
  -v $PWD/../credentials:/credentials:ro `
  fwd-contable-ai-backend
```

Healthcheck integrado: `docker inspect fwd-contable-ai-backend | grep Health`.

### Easypanel + Docker

1. Easypanel → **+ Service** → **App** → **From Source**.
2. Buildpack: **Dockerfile**, ubicación `backend/Dockerfile`.
3. Volúmenes:
    - `/data` → 1 GB persistente.
    - `/credentials` → secret-file con el JSON de Service Account.
4. Variables: pegá las del `.env.docker.example` con valores reales.
5. Puerto: `3000`. Dominio: `contable-api.tuoaro.host`.
6. Health check path: `/health`.
7. Deploy.

---

## 5. Comandos de mantenimiento

```powershell
# Ver logs del backend en vivo
cd backend ; npm run dev

# Backup del SQLite (¡diario!)
Copy-Item backend/data/fwd-contable.db backups/fwd-contable-$(Get-Date -Format yyyyMMdd).db

# Rotar JWT_SECRET (invalida todos los tokens activos → contadores tienen que re-loguear)
node -e "console.log(require('crypto').randomBytes(32).toString('base64'))" | Set-Clipboard
# Pegá el resultado en backend/.env línea JWT_SECRET=...

# Cerrar sesiones activas sin rotar secret: borrar la fila de users y crearla de nuevo
sqlite3 backend/data/fwd-contable.db "DELETE FROM users WHERE email='admin@forwardcr.com';"
npm run db:init   # recrea el admin desde .env

# Ver últimas 10 facturas procesadas
sqlite3 backend/data/fwd-contable.db `
  "SELECT fecha_emision, proveedor_cedula, total_factura FROM facturas ORDER BY fecha_procesamiento DESC LIMIT 10;"

# Limpiar el cache de tipos de cambio + cédulas (forzar refresh contra Hacienda)
sqlite3 backend/data/fwd-contable.db `
  "DELETE FROM tipo_cambio_cache; DELETE FROM cedulas_cache;"
```

---

## 6. Troubleshooting frecuente

| Síntoma | Causa probable | Acción |
|---|---|---|
| El browser muestra `CORS error` al hacer login | `CORS_ORIGINS` del backend no incluye el dominio del frontend | Editar `backend/.env`, agregar el origin exacto, reiniciar |
| `/auth/login` devuelve `503 AUTH_ERROR` | El backend no tiene `JWT_SECRET` | Setear `JWT_SECRET` en `.env`, reiniciar |
| El frontend abre pero todas las llamadas fallan | El túnel está caído o `VITE_API_URL` apunta mal | Verificar `cloudflared tunnel info fwd-contable`; rebuild del frontend si cambió la URL |
| Las facturas no aparecen en el Sheet | `GOOGLE_SHEET_ID_FUNDACION_CRC` vacío o la SA no fue compartida con el Sheet | Correr `npm run sheets:setup` para auto-detectar; o compartir el Sheet manualmente |
| El motor procesa una factura pero responde 500 | Sesión de Claude Code Max expirada | En la PC, abrir `claude` en terminal, verificar `claude /status`, re-login |
| Docker build falla con `Could not find Python` | Solo aplica si bajaste a `better-sqlite3` <12 | El `package.json` ya pinea ^12.10.0 con prebuilts; verificar |

---

## 7. Costos finales (Opción A)

| Servicio | Costo mensual |
|---|---|
| Claude (Max plan del usuario, ya pago aparte) | $0 marginal |
| Hacienda CR API | $0 (pública sin auth) |
| Google Sheets / Drive API | $0 (free tier permanente, < 300 req/min) |
| Cloudflare Tunnel | $0 (gratis para siempre) |
| Easypanel (VPS del usuario, ya paga) | $0 marginal |
| **Total marginal del deploy** | **$0** |

---

## 8. Próximos pasos sugeridos

- **Backup automático diario** del `fwd-contable.db` a Google Drive (workflow n8n con schedule).
- **Monitoreo**: el endpoint `/health` ya existe; agregar UptimeRobot gratis apuntando al túnel.
- **Multi-empresa**: si llegan más clientes, agregar un selector de empresa en el header del frontend (admin); contadores siguen forzados a su empresa.
- **Logs centralizados**: enviar los logs JSON de winston a Easypanel via `docker logs`.
