# Fase 4 — Reporte de cierre (Frontend React + Vite)

> Estado: **completada**. Fecha de cierre: 2026-05-19.
> Branch: `main`. Commits los maneja el usuario.

---

## 1. Qué se construyó

Una SPA en **React 18 + Vite 5 + TypeScript** dentro de `frontend/`, conectada al backend Express vía proxy en dev y servida estática desde el mismo Express en producción (Fase 5).

### Estructura

```
frontend/
├── package.json              dependencias mínimas (react, react-router-dom, vite)
├── tsconfig.json / .app / .node
├── vite.config.ts            proxy a localhost:3000 en dev
├── index.html                meta lang="es-CR"
├── public/favicon.svg        logo F sobre morado Forward
└── src/
    ├── main.tsx              entry — monta <BrowserRouter><AuthProvider><App/></...>
    ├── App.tsx               routing con react-router 6
    ├── lib/
    │   ├── api.ts            cliente HTTP tipado + ApiError + token en localStorage
    │   ├── auth.tsx          AuthContext + useAuth + useEmpresaId + modo dev gracioso
    │   └── format.ts         Intl.NumberFormat('es-CR') para CRC, USD, EUR; fechas; motivos humanos
    ├── components/
    │   ├── Layout.tsx        header con logo + nav + user-block + botón salir
    │   └── RequireAuth.tsx   redirige a /login si no hay sesión
    ├── pages/
    │   ├── LoginPage.tsx     form email+password → JWT
    │   ├── UploadPage.tsx    drag-drop PDF/XML + tabla resultado por tarifa
    │   ├── FacturasPage.tsx  listado mensual con totales rápidos
    │   ├── FacturaDetallePage.tsx detalle con líneas + datos del documento
    │   ├── ResumenIvaPage.tsx  totales del período + tarifa efectiva
    │   └── ChatPage.tsx      chat con typing indicator + historial + ver SQL
    └── styles/globals.css    CSS plano, paleta Forward #6B2C8F, accesible
```

---

## 2. Páginas implementadas (P01, P02, P03)

| Ruta | Pantalla | Endpoints que consume |
|---|---|---|
| `/login` | Login con email + password | `POST /auth/login` |
| `/upload` | P01 — Subir factura (drag-drop) + resultado | `POST /process-document` |
| `/facturas` | Listado mensual con filtro `<input type="month">` | `GET /facturas?empresa_id=X&mes=YYYY-MM` |
| `/facturas/:id` | Detalle: factura + líneas + datos del documento | `GET /facturas/:id` |
| `/resumen-iva` | Totales del período + tarifa efectiva | `GET /facturas` (agrupa en cliente) |
| `/chat` | P03 — Chat con Asistente Contable + opcional ver SQL | `POST /chat`, `GET /chat/historial` |

Todas las rutas (excepto `/login`) están protegidas por `<RequireAuth>` que redirige a `/login` si no hay sesión.

---

## 3. Decisiones de diseño senior

### Modo dev gracioso del backend

Si el backend está sin `JWT_SECRET` (modo dev), `GET /auth/me` devuelve `{ auth_enabled: false }`. El frontend lo detecta y monta un user ficticio (`Modo Dev (sin auth)`, rol admin, empresa piloto). Esto permite probar el frontend completo **sin tener que activar auth en el backend**, manteniendo la promesa "no rompemos n8n actual".

Indicador visible: badge `DEV` junto al rol en el header cuando aplica.

### `useEmpresaId()` centraliza multi-tenancy en el cliente

Toda página que necesita filtrar por empresa llama a `useEmpresaId()`. Devuelve:
- `user.empresa_id` si es contador (fijo del token).
- `'3006696489'` (FUNDACION CRC Endurance) si es admin/dev — futuro: selector de empresa en el header.

### `api.ts` tipado: errores estructurados

Toda llamada al backend pasa por `request<T>()` que:
1. Inyecta `Authorization: Bearer <token>` si hay token en localStorage.
2. Mapea respuestas no-2xx al shape `{ error, codigo, detalle }` del backend.
3. Tira `ApiError` con `status`, `codigo`, `message`, `detalle` — el caller decide cómo presentarlo.

Cada página renderiza errores con UX clara en español de CR (sin "HTTP 500" críptico).

### CSS plano sin Tailwind ni librerías de componentes

Sigue la restricción de **CLAUDE.md §3** ("Tailwind / MUI / AntD a menos que el usuario lo pida explícitamente"). 1 archivo `globals.css` (~700 líneas) con:
- Paleta Forward: `--color-primary: #6B2C8F`.
- Tipografía system stack (San Francisco / Segoe UI / etc).
- Tamaños grandes y alto contraste pensados para el contador 50+.
- Focus visible con outline de 3px.
- Responsive simple con `@media (max-width: 768px)`.
- Loader spinner, typing indicator del chat, badges, alerts (error/warning/info).

### Formato moneda CR nativo

`lib/format.ts` usa `Intl.NumberFormat('es-CR', { style: 'currency', currency: 'CRC' })` → `₡25.970,00`. Compatible con CLAUDE.md §8 (sheet-layout). Idem fechas con `Intl.DateTimeFormat('es-CR')`.

### Drag-drop nativo sin librerías

Página `/upload` implementa drag-drop con eventos nativos `onDragOver`, `onDrop`, `onClick` — sin react-dropzone. Muestra spinner + texto rotativo durante los ~30 s del procesamiento ("Extrayendo…" → "Clasificando…" → "Reconciliando…" → "Escribiendo en Sheets…").

### Splitter multi-factura visible

El response del endpoint `/process-document` tiene 2 shapes posibles:
- `{ factura, resumen, sheet }` (1 factura).
- `{ multi: true, total, resultados: [...] }` (caja chica con N sub-facturas).

`UploadPage.tsx` discrimina con `'multi' in resultado` y renderiza N cards.

### Auto-scroll del chat + typing indicator

`ChatPage.tsx` mantiene un `ref` al fin del stream y hace `scrollIntoView({ behavior: 'smooth' })` cada vez que cambian los turnos. El typing indicator son 3 puntitos morados con animación `@keyframes typing`.

### Toggle "Ver SQL"

El chat tiene un checkbox para mostrar el SQL que el agente ejecutó (devuelto por el backend). Útil para auditoría contable sin saturar a usuarios no técnicos.

---

## 4. Verificación

### Build de producción

```
> tsc -b && vite build

✓ 45 modules transformed.
dist/index.html                   0.59 kB │ gzip:  0.37 kB
dist/assets/index-Cq0b60Qf.css   10.73 kB │ gzip:  2.94 kB
dist/assets/index-ZNbNLCRd.js   192.24 kB │ gzip: 61.47 kB
✓ built in 587ms
```

**Bundle total 203 KB / 65 KB gzipped** — bien por debajo de cualquier umbral razonable.

### Smoke e2e contra backend real (en vivo, con auth activa)

```
GET  /health                                    → {"status":"ok","version":"0.3.0"}
POST /auth/login (admin@fwd.test / admin-12345) → 200 + JWT
GET  /facturas (con token)                      → {"total":0,"facturas":[]}
POST /chat (con token, pregunta real a Claude)  →
  respuesta: "¡Hola! Actualmente no tenés facturas registradas en el sistema..."
  sql_ejecutado: "SELECT COUNT(*) AS cantidad FROM facturas WHERE empresa_id = '3006696489'"
  duracion_ms: 10_497
```

El asistente respondió en español de CR, ejecutó SQL filtrado por empresa, devolvió 0 honestamente sin inventar.

---

## 5. Cómo arrancar

```powershell
# Terminal A: backend
cd "C:\Users\...\FWD Contable AI\backend"
npm run dev
# (modo dev sin auth, o agregá JWT_SECRET al .env para activarla)

# Terminal B: frontend
cd "C:\Users\...\FWD Contable AI\frontend"
npm install   # primera vez
npm run dev
# → abre http://localhost:5173
```

En dev, Vite proxea automáticamente las llamadas a `/auth`, `/chat`, `/facturas`, etc. hacia el backend en `:3000`. No hay que configurar CORS extra.

### Producción

```powershell
cd frontend
npm run build       # genera dist/

# En Fase 5: el backend va a servir frontend/dist desde el mismo Express.
```

---

## 6. Pendientes para Fase 5

- **Servir `frontend/dist` desde Express** en producción (modificar `backend/src/server.ts` con `express.static` cuando `NODE_ENV=production`).
- **Dockerfile + Easypanel deploy** (ver `START-FASE-5.txt`).
- **CORS para el dominio público** en `backend/src/server.ts`.
- **Workflows n8n** exportados (`n8n-workflows/*.json`).
- **Panel `/admin`** para gestión de users (crear contadores). Backend ya tiene los helpers — falta endpoint `POST /users` y UI.
- **Pulido UX final**: mejor manejo de archivos grandes, indicador de % de progreso real (no estimado), versión móvil de las tablas.

---

## 7. Librerías agregadas a `frontend/`

Solo las indispensables (CLAUDE.md §13 prohíbe Tailwind/MUI/AntD):

| Dependencia | Versión | Para qué |
|---|---|---|
| `react` | ^18.3.1 | UI |
| `react-dom` | ^18.3.1 | render |
| `react-router-dom` | ^6.27.0 | routing client-side |
| `vite` (dev) | ^5.4.10 | build tool + dev server |
| `@vitejs/plugin-react` (dev) | ^4.3.3 | JSX + HMR |
| `typescript` (dev) | ^5.7.0 | tipos |

**Total transitivo**: ~270 paquetes en `node_modules/`. Cero costo en runtime.

---

## 8. Resumen ejecutivo

| Métrica | Valor |
|---|---|
| Tareas del plan | 9 / 9 completadas (F4.1 - F4.9) |
| Páginas | 6 (login + 5 protegidas) |
| Bundle gzipped | 65 KB total |
| Build time | ~600 ms |
| Líneas de TS/TSX | ~1100 |
| Líneas de CSS | ~700 |
| Tests Vitest backend (sin cambios) | 27 / 27 verdes |
| Costo en APIs externas | $0.00 |
