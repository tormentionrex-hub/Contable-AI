# PROMPT — Fase 2: MCPs + Google Sheets + Splitter + Vision

> Antes de pegar el prompt a Claude Code, tenés que completar **2 registros externos**. Te toman ~15 min en total. Sin esto, el otro Claude se va a frenar.

---

## Pre-requisito 1: Registro en BCCR (tipo de cambio)

El Banco Central de Costa Rica expone un web service gratuito para obtener el tipo de cambio del día. Necesita registro.

1. Abrí https://gee.bccr.fi.cr/Indicadores/Suscripciones/WS/wsindicadoreseconomicos.asmx
2. Hacé clic en "Solicitar suscripción" (link arriba a la derecha).
3. Llená el formulario con tu nombre y email. **No piden tarjeta**.
4. Te llega un mail con tu `tokenSubscripcion`.
5. Agregalo a `engine/.env` (creá el archivo si no existe, copiando de `.env.example`):

```
BCCR_NOMBRE=Christopher Gonzalez
BCCR_EMAIL=gonzalezbustamantechristopher@gmail.com
BCCR_TOKEN=<el token que te llegó por mail>
```

## Pre-requisito 2: Service Account de Google Cloud (para Sheets)

Necesitamos una cuenta de servicio que pueda crear y editar Google Sheets en tu nombre. Es gratis. Pasos:

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

7. **Agregar la variable al `.env`**:

```
GOOGLE_SERVICE_ACCOUNT_JSON=./credentials/google-service-account.json
GOOGLE_SHEET_ID_FUNDACION_CRC=
CONTADOR_EMAIL=gonzalezbustamantechristopher@gmail.com
```

`GOOGLE_SHEET_ID_FUNDACION_CRC` se deja vacío: el otro Claude va a **crear el Sheet automáticamente** en su primer arranque y guardar el ID en la base. Cuando termine te avisa con qué ID quedó.

`CONTADOR_EMAIL` es la cuenta con la que vos vas a abrir el Sheet (te lo va a compartir como editor).

---

## Cómo lanzar Fase 2

Con los 2 pre-requisitos listos:

### Paso 1 — Verificá que `.env` tiene todo

```powershell
Get-Content "C:\Users\torme\OneDrive\Desktop\FWD Contable AI\engine\.env"
```

Tenés que ver las 3 variables BCCR_*, GOOGLE_SERVICE_ACCOUNT_JSON y GOOGLE_SHEET_ID_FUNDACION_CRC (vacío) y CONTADOR_EMAIL.

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
- Va a crear 3 servidores MCP (carpetas nuevas con sus propios `package.json`).
- Va a interactuar con Google Sheets API real (creando el Sheet, formateándolo, escribiendo filas).
- Va a probar contra BCCR y Hacienda en vivo.
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
| `BCCRError: Indicador no encontrado` | Token incorrecto o expirado | Verificá `.env` BCCR_TOKEN. Pedile a Claude que loguee el body de la request al BCCR para ver el error real |
| `403 PERMISSION_DENIED` al crear Sheet | Sheets API o Drive API no habilitadas | Volvé al paso 3 de Pre-requisito 2 y habilitalas |
| `Error: ENOENT credentials/google-service-account.json` | El JSON no quedó en la carpeta correcta | Verificá con `Test-Path` del Paso 2 |
| MCP no arranca, error de stdio | Posible incompatibilidad del SDK MCP con Node 24 | Pedile a Claude que mire la versión de `@modelcontextprotocol/sdk` y use la que soporta Node 20-24 |
| Splitter dice "1 factura" en el PDF de Caja Chica | Heurística muy estricta | Pedile a Claude que use Claude Vision en el primer paso para identificar páginas de inicio de factura, no solo regex |
| El Sheet aparece pero sin formato (sin color, sin fórmulas) | El módulo no aplicó el `batchUpdate` con `repeatCell` | Pedile a Claude que verifique el código de `createMachote` contra `engine/schemas/sheet-layout.md` |

---

## Recordá

- **NO subir a GitHub**. El otro Claude tiene la instrucción pero por si acaso, no le digas que haga `git push`.
- Los archivos en `credentials/` y `.env` están en `.gitignore`. **Nunca** los compartas en commits.
- Si querés ver el progreso en vivo, el otro Claude va a estar mostrando logs en su terminal. Podés abrirla y mirar.

Te leo cuando vuelvas con el reporte de Fase 2.
