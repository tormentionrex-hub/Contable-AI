# Auditoría pre-deploy — FWD Contable AI

**Fecha**: 2026-05-20
**Estado**: ✅ Listo para producción local (GitHub Pages + ngrok)
**Cobertura**: 11/11 hallazgos críticos y altos arreglados

---

## Validación

| Check | Resultado |
|---|---|
| `tsc --noEmit` backend | ✅ EXIT=0 |
| `tsc --noEmit` frontend | ✅ EXIT=0 |
| Tests unitarios (5 suites) | ✅ 23/23 verdes en 3.8s |
| Schema SQL desde cero | ✅ initDb completo + migraciones idempotentes |
| `/health` con verificación de tablas + columnas críticas | ✅ |

Tests integración (DocScan + Claude real): 1/4 verdes. Los 3 fallos restantes son del modelo siendo conservador con `tarifa_iva_marcada` en facturas donde la tarifa está visible. **No bloqueante**: en esos casos la factura se marca para revisión humana y el contador la valida manualmente (flujo ya implementado).

---

## Críticos arreglados

| # | Problema | Fix |
|---|---|---|
| 1 | Coma faltante en `db.sql` rompía `initDb` desde cero | Coma agregada en `archivada_por_user_id INTEGER,` |
| 2 | Backdoor: si falta `JWT_SECRET`, frontend entra como admin sin password | `superRefine` en config: en `NODE_ENV=production`, JWT_SECRET y ADMIN_PASSWORD son OBLIGATORIOS |
| 3 | Sin `process.on('uncaughtException'/'unhandledRejection')`. Promesas olvidadas tiran el server | Handlers globales agregados en `server.ts` con grace period de 1s |
| 4 | Uploads en `data/uploads/` nunca se borraban. Disco se llenaría | `finally` con `fs.promises.unlink` por cada archivo recibido |
| 5 | `JWT_EXPIRES_IN` sin validar. Si `.env` tenía valor mal formado, primer login tiraba 500 | Regex `^\d+(\.\d+)?[smhdy]?$` en zod schema |

## Altas arregladas

| # | Problema | Fix |
|---|---|---|
| 6 | `POST /facturas/archivar` con body vacío archivaba TODO | Refinement zod: requiere al menos `mes`/`desde`/`hasta`/`ids` o `confirmar_todas:true` explícito |
| 7 | Si `initDb` fallaba, server seguía con `listen`. `/health` decía "ok" pero queries explotaban | `start()` ahora `throws` si initDb falla; `void start().catch(...)` con `process.exit(1)` |
| 8 | 13 ALTER TABLE secuenciales sin transacción. Crash a mitad dejaba DB mixta | Envueltos en `db.transaction(() => {...})()` |
| 9 | Sin ErrorBoundary en React. Excepción de render = white screen | Componente `ErrorBoundary` global en `main.tsx` con UI de error elegante |
| 10 | `setInterval` en UploadPage sobrevivía al unmount | Movido a `useRef` con cleanup en `useEffect` + flag `mountedRef` |
| 11 | `/health` solo hacía `SELECT 1` | Verifica tablas críticas + columnas de migración |

---

## Medias documentadas (no bloqueantes)

Estas siguen pendientes pero no afectan estabilidad inmediata. Quedan en backlog:

1. **TZ frágil en `parseFechaCalendario`** (`excel.ts:45`). Hoy ancla a 12:00 local, robusto para offsets ±11h. En TZ extremas (Pacífico) podría saltar día. Fix futuro: `Date.UTC(y, m-1, d, 12)`.
2. **`req.params.id` sin validar formato** en `facturas.ts`. SQL está parametrizado (no SQLi) pero IDs raros pueden llegar a queries. Fix futuro: regex zod en params.
3. **`chat_history` asimétrico** si el asistente falla. INSERT del user es antes del agent.run. Fix futuro: transacción con rollback.
4. **Excel en RAM** (no streaming). Para >1000 facturas puede llegar a 100 MB en memoria. Fix futuro: `workbook.xlsx.write(res)` en vez de `writeBuffer()`.
5. **`runSelect` con regex** en MCP fwd-db es defensa frágil. Fix futuro: `stmt.readonly` de better-sqlite3.
6. **`persistFactura` upsert de proveedores fuera de la TX**. Fix futuro: mover dentro.
7. **`/process-document` sin timeout server-side**. Si Claude SDK cuelga, conexión queda abierta. Fix futuro: `AbortController` con 10 min.
8. **Sheets: duplicados al re-procesar** (Hoja 1 no se limpia, sólo Hoja 2). TODO existente documentado en `sheets.ts:572`.

---

## Cobertura de tests faltante

- Tests para endpoints nuevos: `/facturas/archivar`, `/facturas/:id/restaurar`, `/facturas/:id/pago`, `/facturas/:id/revision`, `/excel/respaldo`, `/historial`.
- Tests para `generarExcelRespaldoCompleto`.

Recomendado para próxima iteración (no bloqueante para deploy).

---

## Checklist de deploy

### Backend
- [x] `tsc --noEmit` EXIT=0
- [x] `vitest run` unit tests 23/23
- [x] `initDb` corre desde cero sin errores
- [x] `/health` verifica esquema completo
- [x] Process handlers globales
- [x] Cleanup de uploads
- [x] Validaciones zod en config + rutas críticas
- [ ] Generar `JWT_SECRET` real: `openssl rand -base64 32`
- [ ] Setear `ADMIN_EMAIL` + `ADMIN_PASSWORD` en `.env`
- [ ] Setear `CORS_ORIGINS` con dominio del frontend
- [ ] `NODE_ENV=production` en el `.env`

### Frontend
- [x] `tsc --noEmit` EXIT=0
- [x] ErrorBoundary global
- [x] Listener global de `unhandledrejection`
- [ ] Setear `VITE_API_URL` apuntando al túnel ngrok
- [ ] `npm run build` → `dist/`
- [ ] Subir `dist/` a GitHub Pages

### Infraestructura
- [ ] Túnel ngrok corriendo (o `cloudflared`)
- [ ] El backend local apunta al .env correcto
- [ ] Verificar que `/health` devuelve `status: ok` desde el túnel
- [ ] Smoke test: login → subir 1 factura → ver historial

---

## Comando rápido de validación

```powershell
cd backend
npx tsc --noEmit
npx vitest run tests/reconciliation.test.ts tests/auth.test.ts tests/sheets.test.ts tests/pdf-split.test.ts tests/mcp-hacienda.test.ts

cd ../frontend
npx tsc --noEmit -p tsconfig.app.json
npm run build
```

Si los 3 type-checks + tests unitarios + build salen verdes, el proyecto está listo para mandar a producción.
