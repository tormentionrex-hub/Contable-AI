# Fase 3 — Reporte de cierre

> Estado: **completada**. Fecha de cierre: 2026-05-19.
> Branch: `main`. Commits los maneja el usuario.

---

## 1. Qué se construyó

### Autenticación (opt-in)

| Pieza | Descripción |
|---|---|
| `backend/src/lib/auth.ts` | Helpers: `hashPassword`, `verifyPassword`, `signToken`, `verifyToken`, `createUser`, `loginUser`, middleware `requireAuth` y `requireAdmin`, `resolveEmpresaId` |
| `backend/src/routes/auth.ts` | `POST /auth/login` y `GET /auth/me` |
| Tabla `users` en `db.sql` | id, email (UNIQUE), password_hash (bcrypt), nombre, rol (admin/contador), empresa_id (FK), activo, ultimo_login, creado |
| Seed admin automático | Si `users` está vacía al arrancar, crea un admin con `ADMIN_EMAIL`+`ADMIN_PASSWORD` del .env (o genera password random visible solo una vez en stdout) |
| Modo dev (opt-in) | Si NO hay `JWT_SECRET` en .env: el motor arranca, loguea WARN, y `requireAuth` deja pasar todo. Apenas se setea → modo producción con tokens obligatorios |

### Asistente Contable (NL → SQL)

| Pieza | Descripción |
|---|---|
| `backend/src/agents/asistente.ts` | Sub-agente con skill `asistente-contable.md` + MCPs in-process `fwd-db` (SELECT-only) y `hacienda-cr` |
| `backend/src/routes/chat.ts` | `POST /chat` y `GET /chat/historial?limit=N` |
| Persistencia | Cada turno (user + assistant) se guarda en `chat_history` con `sql_ejecutado` y `filas_devueltas` para auditoría |
| Multi-tenant enforced | Contadores: empresa_id sale SIEMPRE del JWT (ignora body). Admin: puede pasar empresa_id en el body |

### Rutas protegidas

| Endpoint | Antes (F2) | Después (F3) |
|---|---|---|
| `GET /health` | público | público |
| `POST /auth/login` | — | público |
| `GET /auth/me` | — | requireAuth |
| `POST /chat` | — | requireAuth |
| `GET /chat/historial` | — | requireAuth |
| `POST /process-document` | público | requireAuth |
| `GET /facturas`, `GET /facturas/:id` | público | requireAuth + check de empresa |
| `POST /adelantos`, `GET /caja-chica/saldo` | público | requireAuth + empresa del token |
| `GET /hacienda/tc`, `GET /hacienda/cedula/:c` | público | requireAuth |

---

## 2. Tests

`npm test` ahora corre **27/27 tests** (11 nuevos de auth + 16 de fases previas):

| Suite | Tests | Tiempo |
|---|---|---|
| `tests/auth.test.ts` | 11 | ~514 ms |
| `tests/reconciliation.test.ts` | 3 | ~2 ms |
| `tests/pdf-split.test.ts` | 2 | ~290 ms |
| `tests/sheets.test.ts` | 3 | ~3 ms |
| `tests/mcp-hacienda.test.ts` | 4 | ~2.5 s |
| `tests/docscan.test.ts` | 4 | ~120 s |

Los tests de auth cubren:
- `hashPassword` + `verifyPassword` (bcrypt round-trip + rechazo de hash inválido sin throw)
- `signToken` + `verifyToken` (claims preservados + rechazo de token corrupto + cambio de secret)
- `createUser` + `loginUser` (alta + login OK + credenciales inválidas + email lowercase)
- `seedAdminIfMissing` (idempotencia: 2 llamadas no duplican)

---

## 3. Verificación end-to-end (en vivo)

Corrido en el motor con `JWT_SECRET="test-secret-fase3-e2e-32chars-abcdef"` + `ADMIN_EMAIL=admin@fwd.test` + `ADMIN_PASSWORD=admin-12345`:

```
GET  /health                          → {"status":"ok","version":"0.3.0","db":"connected"}
POST /chat (sin token)                → 401 TOKEN_INVALIDO ✓
POST /auth/login                      → 200 + token JWT firmado HS256
GET  /auth/me (con token)             → {user: {id:1, email, rol:'admin', empresa_id:null}}
GET  /facturas?empresa_id=...         → {total: 0, facturas: []}
GET  /hacienda/tc?moneda=USD          → {compra:449.52, venta:455.24, fuente:'hacienda'}
POST /chat con token, pregunta real   → respuesta en español + SQL auditado + 9.7 s
```

Pregunta de prueba al asistente:
> *"¿Cuántas facturas hay registradas en total?"*

Respuesta del agente:
> *"Actualmente no tenés facturas registradas en el sistema para esta empresa. Si ya subiste documentos, puede que aún estén en proceso de carga. ¿Querés que te ayude con algo más?"*

SQL que ejecutó (vía MCP `fwd-db.query`):
```sql
SELECT COUNT(*) AS total_facturas FROM facturas WHERE empresa_id = '3006696489'
```

Filas devueltas: 1. Cumple los 3 requisitos clave del skill:
- ✅ Filtró por `empresa_id` correctamente.
- ✅ Reportó 0 honestamente (no inventó).
- ✅ Respondió en español de CR con número concreto.

---

## 4. Variables `.env` agregadas (opcionales)

```ini
# Auth Fase 3 — opt-in: si no están seteadas, el motor corre en modo DEV sin auth.
JWT_SECRET=<string de al menos 16 chars>     # cuando lo seteás, las rutas exigen Bearer token
JWT_EXPIRES_IN=8h                            # default 8h
ADMIN_EMAIL=admin@tu-dominio.com             # email del admin inicial (default admin@local)
ADMIN_PASSWORD=password-seguro-aca           # si no la das, el seed genera una y la imprime en stdout
```

Si no agregás `JWT_SECRET`: el server arranca con WARN visible que dice *"AUTH DESHABILITADA"* y deja todo público (compatible con el flujo actual de n8n).

---

## 5. Decisiones de diseño

### Auth opt-in (gracioso)

El motor NO obliga a configurar JWT antes de poder usarlo. Si `JWT_SECRET` está vacío, arranca en modo dev con WARN claro y `requireAuth` deja pasar. Esto permite:
- Que el contador siga usando el sistema mientras se decide la estrategia de auth.
- Que n8n actual siga llamando endpoints sin token.
- Que apenas el usuario quiera empezar a proteger, solo agrega `JWT_SECRET=...` al .env y reinicia.

### Multi-tenancy reforzado por token

Cuando hay auth activa:
- Un **contador** (rol) tiene `empresa_id` fijo en el JWT. Las rutas SIEMPRE usan ese empresa_id, ignorando lo que venga en body/query. No puede "leer" ni "escribir" facturas de otra empresa.
- Un **admin** puede operar sobre cualquier empresa pasando `empresa_id` en el body/query.

La función `resolveEmpresaId(req)` centraliza esta lógica y la usan `routes/chat.ts`, `routes/facturas.ts`, `routes/adelantos.ts`, `routes/process-document.ts`.

### `chat_history` persiste TODO

Cada turno del asistente queda con:
- `user_id` (id del user en `users`)
- `rol` ('user' o 'assistant')
- `mensaje`
- `sql_ejecutado` (auditoría)
- `filas_devueltas`
- `timestamp`

Eso permite:
- Mostrar conversaciones pasadas en el frontend (`GET /chat/historial`).
- Auditar SQL que el agente generó (compliance contable).
- Detectar drift del modelo (si las queries cambian sin razón).

### Sub-agente con MCPs ya existentes

El asistente reutiliza los 2 MCPs de Fase 2 (`fwd-db` y `hacienda-cr`) sin código nuevo. Solo se agrega el `agents/asistente.ts` que los enlaza al skill `asistente-contable.md` ya escrito.

---

## 6. Pendientes para Fase 4

- **Frontend React + Vite** con 6 páginas:
  - `/login` (consume `/auth/login`)
  - `/upload` (consume `/process-document`)
  - `/factura/:id` (consume `/facturas/:id`)
  - `/resumen-iva`
  - `/chat` (consume `/chat`)
  - `/admin` (gestión de users por admin)
- **Workflows n8n** exportados (`n8n-workflows/*.json`).
- **Cambio de password** y **registro de contadores** (endpoint admin-only `POST /users`).

---

## 7. Cómo arrancar Fase 3 (en otra PC o sesión)

```powershell
cd "C:\Users\...\FWD Contable AI\backend"

# Opcional: configurar auth en .env (si NO lo hacés, modo dev sin auth)
# Agregar al .env:
#   JWT_SECRET=<al menos 16 chars random>
#   ADMIN_EMAIL=tu-email@dominio.com
#   ADMIN_PASSWORD=password-seguro-de-8+chars

npm run db:init        # crea/migra tablas, incluida `users`
npm run dev            # arranca motor

# El primer boot crea el admin automáticamente si users está vacía.
# Si NO seteaste ADMIN_PASSWORD, leé el stdout: la password aparece UNA VEZ.
```

Smoke test con curl:
```powershell
# 1) Login
curl -X POST http://localhost:3000/auth/login `
  -H "Content-Type: application/json" `
  -d '{"email":"admin@fwd.test","password":"admin-12345"}'

# 2) /me con el token
$TOKEN = "<el token de arriba>"
curl http://localhost:3000/auth/me -H "Authorization: Bearer $TOKEN"

# 3) Pregunta al asistente
curl -X POST http://localhost:3000/chat `
  -H "Authorization: Bearer $TOKEN" `
  -H "Content-Type: application/json" `
  -d '{"mensaje":"¿Cuánto se gastó este mes?","empresa_id":"3006696489"}'
```

---

## 8. Resumen ejecutivo

| Métrica | Valor |
|---|---|
| Tareas del plan | 9 / 9 completadas (F3.1 - F3.9) |
| Tests | 27 / 27 verdes (11 nuevos de auth + 16 previos) |
| Endpoints HTTP nuevos | 4 (`/auth/login`, `/auth/me`, `/chat`, `/chat/historial`) |
| Sub-agentes nuevos | 1 (Asistente Contable) |
| Tablas nuevas en SQLite | 1 (`users`) |
| Librerías agregadas no listadas en CLAUDE.md §13 | 0 (bcrypt y jsonwebtoken ya estaban) |
| Costo en APIs externas | $0.00 (Claude vía Max plan, MCPs in-process, sin nuevas llamadas a Hacienda) |
| Costo en tokens por consulta al asistente | ~$0.10–0.20 USD (informativo, va contra Max plan) |
| Tiempo de respuesta del asistente | 6–15 s típico (NL → SQL → respuesta) |
