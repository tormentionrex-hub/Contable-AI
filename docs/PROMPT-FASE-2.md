# PROMPT — Fase 2: MCPs + Google Sheets + Splitter + Vision

> Antes de pegar el prompt a Claude Code, tenés que completar **1 sólo registro externo** (Google). El BCCR queda fuera: usamos la API pública de Hacienda CR que no requiere ningún token.

---

## Pre-requisito único: Service Account de Google Cloud (para Sheets)

Necesitamos una cuenta de servicio que pueda crear y editar Google Sheets en tu nombre. **Es 100 % gratis y no pide tarjeta** dentro del free tier de Google Cloud (que cubre 300 requests/minuto a Sheets — nosotros usamos < 10 por día). Pasos:

1. Andá a https://console.cloud.google.com/
2. **Crear proyecto nuevo**: arriba a la izquierda, "Seleccionar proyecto" → "Proyecto nuevo".
   - Nombre: `fwd-contable-ai`
   - Sin organización (a menos que tengas Workspace).
   - Clic en "Crear".
3. **Habilitar Google Sheets API** y **Google Drive API**:
   - Menú lateral → "APIs y servicios" → "Biblioteca".
   - Buscá "Google Sheets API" → "Habilitar".
   - Buscá "Google Drive API" → "Habilitar".
4. **Crear la Service Account**:
   - Menú lateral → "IAM y administración" → "Cuentas de servicio".
   - Clic en "Crear cuenta de servicio".
   - Nombre: `fwd-contable-ai-bot`
   - ID: se autocompleta.
   - Clic en "Crear y continuar". Saltá los roles (no hace falta nivel de proyecto).
   - Clic en "Listo".
5. **Generar la clave JSON**:
   - En la lista de cuentas de servicio, hacé clic en el email de la que acabás de crear.
   - Pestaña "Claves" → "Agregar clave" → "Crear clave nueva" → tipo JSON.
   - Se descarga un archivo `.json`.
6. **Mover el JSON al proyecto**:
   - Creá la carpeta `credentials/` en la raíz del proyecto (la `.gitignore` ya la excluye, no se va a subir a GitHub).
   - Mové el JSON descargado ahí y renombralo a `google-service-account.json`.

   ```powershell
   New-Item -ItemType Directory "C:\Users\torme\OneDrive\Desktop\FWD Contable AI\credentials" -Force
   Move-Item "$HOME\Downloads\fwd-contable-ai-*.json" `
             "C:\Users\torme\OneDrive\Desktop\FWD Contable AI\credentials\google-service-account.json"
   ```

7. **Agregar las variables al `.env`** de `backend/`:

```
GOOGLE_SERVICE_ACCOUNT_JSON=./credentials/google-service-account.json
GOOGLE_SHEET_ID_FUNDACION_CRC=
CONTADOR_EMAIL=gonzalezbustamantechristopher@gmail.com
```

`GOOGLE_SHEET_ID_FUNDACION_CRC` se deja vacío: el otro Claude va a **crear el Sheet automáticamente** en su primer arranque y guardar el ID en la base. Cuando termine te avisa con qué ID quedó.

`CONTADOR_EMAIL` es la cuenta con la que vos vas a abrir el Sheet (te lo va a compartir como editor).

---

## ¿Y el tipo de cambio? — Hacienda CR reemplaza a BCCR

Después de auditar el BCCR (registro frágil, token por email que a veces no llega, formulario que falla en navegador) decidimos usar la **API pública del Ministerio de Hacienda de Costa Rica**. Es la fuente oficial alternativa y no necesita NADA:

- **Sin registro**.
- **Sin token**.
- **Sin tarjeta**.
- **Sin variables en `.env`**.

Probada en vivo desde la máquina del proyecto el 17 de mayo de 2026:

```bash
$ curl https://api.hacienda.go.cr/indicadores/tc/dolar
{
  "venta":  { "fecha": "2026-05-16", "valor": 455.61 },
  "compra": { "fecha": "2026-05-16", "valor": 449.17 }
}
```

La misma API también valida cédulas (padrón) y devuelve nombre + actividades económicas, así que **un solo MCP cubre las dos necesidades** (tipo de cambio + validación de proveedor).

**Fallback gratuito por si Hacienda llega a caerse** (no se decide ahora, el MCP lo implementa con retry):

- `https://cdn.jsdelivr.net/npm/@fawazahmed0/currency-api@latest/v1/currencies/usd.json` (Fawaz Ahmed, sin key, hosted en CDN, sin rate limit documentado).
- `https://api.frankfurter.dev/v1/latest?from=USD&to=CRC` (open source, sin key).

Ambos están listados en [public APIs de Costa Rica (ruiznorlan/public-apis-cr)](https://github.com/ruiznorlan/public-apis-cr) y son estables.

---

## Cómo lanzar Fase 2

Con el pre-requisito de Google listo:

### Paso 1 — Verificá que `.env` tiene todo

```powershell
Get-Content "C:\Users\torme\OneDrive\Desktop\FWD Contable AI\backend.env"
```

Tenés que ver: `GOOGLE_SERVICE_ACCOUNT_JSON`, `GOOGLE_SHEET_ID_FUNDACION_CRC` (vacío) y `CONTADOR_EMAIL`.

### Paso 2 — Verificá que el JSON de Google está en su lugar

```powershell
Test-Path "C:\Users\torme\OneDrive\Desktop\FWD Contable AI\credentials\google-service-account.json"
```

Si dice `True`, listo.

### Paso 3 — Copiá el prompt al portapapeles

```powershell
Get-Content "C:\Users\torme\OneDrive\Desktop\FWD Contable AI\START-FASE-2.txt" -Raw | Set-Clipboard
```

### Paso 4 — Lanzá Claude Code en terminal nueva

```powershell
cd "C:\Users\torme\OneDrive\Desktop\FWD Contable AI"
claude
```

Cuando abra, **Ctrl+V** y Enter. El otro Claude lee `CLAUDE.md` y `docs/FASE-1-REPORTE.md` automáticamente y empieza.

### Paso 5 — Dejá correr (40-60 min)

Esta fase es más larga que la 1 porque:
- Va a crear 2 servidores MCP (carpetas nuevas con sus propios `package.json`): `mcp-hacienda-cr` (tipo cambio + padrón) y `mcp-fwd-db` (SQL queries).
- Va a interactuar con Google Sheets API real (creando el Sheet, formateándolo, escribiendo filas).
- Va a probar contra Hacienda CR en vivo (público, sin auth).
- Va a re-correr todos los tests, incluyendo el caso Caja Chica que estaba en skip.

### Paso 6 — Verificación manual

Cuando termine:

1. Leé `docs/FASE-2-REPORTE.md` para el resumen.
2. Buscá el **ID del Google Sheet** en el reporte y abrilo en tu navegador. Te tiene que haber llegado un mail "fwd-contable-ai-bot compartió un Sheet con vos".
3. El Sheet debe tener 4 hojas: Reintegro Caja Chica, Detalle Hacienda, Resumen por Tarifa, Para Revisión.
4. Si lo abrís y todavía está vacío, hacé un curl al endpoint `/process-document` con uno de los PDFs golden y refrescá el Sheet: la fila tiene que aparecer con el formato correcto (logo morado, columnas alineadas, símbolo ₡).

---

## Si algo sale mal

Errores típicos de esta fase y cómo destrabarlos:

| Síntoma | Probable causa | Acción |
|---|---|---|
| `HaciendaError: timeout` | Saturación momentánea o caída de api.hacienda.go.cr | El MCP debe reintentar 2x con backoff exponencial y caer al fallback (jsdelivr/frankfurter). Pedile a Claude que verifique que el retry está implementado. |
| `HaciendaError: 429` | Excedimos rate limit (10 req/seg sostenido) | Pedile a Claude que active el cache local (`tipo_cambio_cache` + `cedulas_cache` con TTL). No debería pasar en uso normal. |
| `403 PERMISSION_DENIED` al crear Sheet | Sheets API o Drive API no habilitadas | Volvé al paso 3 del Pre-requisito y habilitalas. |
| `Error: ENOENT credentials/google-service-account.json` | El JSON no quedó en la carpeta correcta | Verificá con `Test-Path` del Paso 2. |
| MCP no arranca, error de stdio | Posible incompatibilidad del SDK MCP con Node 24 | Pedile a Claude que use `@modelcontextprotocol/sdk` v1.x (es ESM-only, Node 18+, compatible con Node 24). |
| Splitter dice "1 factura" en el PDF de Caja Chica | Heurística muy estricta | Pedile a Claude que use Claude Vision en el primer paso para identificar páginas de inicio de factura, no solo regex. |
| El Sheet aparece pero sin formato (sin color, sin fórmulas) | El módulo no aplicó el `batchUpdate` con `repeatCell` | Pedile a Claude que verifique el código de `createMachote` contra `backend/schemas/sheet-layout.md`. |

---

## Recordá

- **NO subir a GitHub**. El otro Claude tiene la instrucción pero por si acaso, no le digas que haga `git push`.
- Los archivos en `credentials/` y `.env` están en `.gitignore`. **Nunca** los compartas en commits.
- **Costo total de Fase 2: $0**. No uses la API key paga de Anthropic; el sistema corre con tu suscripción Claude Code Max plan.
- Si querés ver el progreso en vivo, el otro Claude va a estar mostrando logs en su terminal.

Te leo cuando vuelvas con el reporte de Fase 2.
