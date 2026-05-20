# Deploy a producción local — GitHub Pages + ngrok

Guía paso a paso de cero a producción. Pensada para que la sigas con calma una sola vez al principio. Después de eso, el deploy es un comando.

---

## Arquitectura

```
+--------------------+           +-----------------------+           +--------------------+
|                    |  HTTPS    |                       |  HTTPS    |                    |
|  Navegador del     |---------->|  GitHub Pages         |           |   ngrok            |
|  contador          |           |  (frontend estático)  |           |                    |
|                    |           |  fwd-contable-ai      |           |                    |
+--------------------+           +-----------------------+           +----------+---------+
                                                                                |
                                                                                | HTTPS
                                                                                v
                                                                     +---------------------+
                                                                     |                     |
                                                                     |  Backend Node.js    |
                                                                     |  corriendo en TU PC |
                                                                     |  localhost:3001     |
                                                                     |                     |
                                                                     +---------------------+
```

- **Frontend** se publica como sitio estático en GitHub Pages (gratis, HTTPS, CDN).
- **Backend** corre en tu PC local (donde tenés Claude Code Max plan logueado).
- **ngrok** expone tu backend a internet con HTTPS, sin abrir puertos.

---

## PARTE 1 — Una sola vez (setup inicial)

### 1.1. Cuenta de GitHub + repo

1. Si no tenés cuenta: crear una en https://github.com (gratis).
2. Crear un repo **público** llamado `fwd-contable-ai` (público porque GitHub Pages gratuito requiere repo público; si querés privado necesitás GitHub Pro).
3. Subir el código por primera vez:

```powershell
cd "C:\Users\HP8CV\OneDrive\Desktop\Contabilidad\FWD Contable AI\FWD Contable AI"
git remote add origin https://github.com/TU-USUARIO/fwd-contable-ai.git
git branch -M main
git push -u origin main
```

### 1.2. Habilitar GitHub Pages

1. Ir al repo en github.com → **Settings** → **Pages** (menú izquierdo).
2. En "Source", elegir **"GitHub Actions"**.
3. Listo. La primera vez que corra el workflow, GitHub crea automáticamente el sitio en `https://TU-USUARIO.github.io/fwd-contable-ai/`.

### 1.3. Instalar ngrok

1. Crear cuenta gratuita en https://ngrok.com (no requiere tarjeta).
2. Descargar el binario de https://ngrok.com/download. Para Windows: `.zip` que contiene `ngrok.exe`. Copialo a `C:\ngrok\` y agregalo al PATH (o dejalo en una carpeta accesible).
3. En la dashboard de ngrok, copiar tu authtoken (Setup & Installation → "Your Authtoken").
4. En PowerShell:

```powershell
ngrok config add-authtoken TU_AUTHTOKEN_AQUI
```

Verificá que está OK:

```powershell
ngrok version
# Debe devolver algo tipo: ngrok version 3.x.x
```

### 1.4. Configurar el .env del backend

Copiá el template y editalo:

```powershell
cd backend
Copy-Item .env.example .env
notepad .env
```

Setear obligatoriamente:

```ini
NODE_ENV=production
JWT_SECRET=AlgoMuyLargoYAleatorio32CharsMinimo
ADMIN_EMAIL=tu@email.com
ADMIN_PASSWORD=algoSeguroDe12Chars
CORS_ORIGINS=https://TU-USUARIO.github.io
```

Para generar un JWT_SECRET seguro:

```powershell
# En PowerShell (Windows):
[Convert]::ToBase64String([System.Security.Cryptography.RandomNumberGenerator]::GetBytes(32))
```

### 1.5. Configurar los Secrets de GitHub Actions

El workflow del frontend necesita saber a qué backend hablar. Esa URL va como un "secret" del repo:

1. En github.com → repo → **Settings** → **Secrets and variables** → **Actions** → **New repository secret**.
2. Crear estos dos secrets:

| Nombre | Valor |
|---|---|
| `VITE_API_URL` | (Vacío por ahora — lo seteamos en la Parte 2.) |
| `VITE_BASE_PATH` | `/fwd-contable-ai/` (con barras al inicio y final, exactamente el nombre del repo) |

---

## PARTE 2 — Cada vez que arranco (operación diaria)

### 2.1. Arrancar el backend + túnel

Doble clic en `scripts/start-prod.ps1` o desde PowerShell:

```powershell
cd "C:\Users\HP8CV\OneDrive\Desktop\Contabilidad\FWD Contable AI\FWD Contable AI"
pwsh -File scripts/start-prod.ps1
```

El script:
1. Verifica que `.env` y `ngrok` estén OK.
2. Arranca el backend en `http://localhost:3001` con `NODE_ENV=production`.
3. Espera a que `/health` responda OK.
4. Levanta el túnel ngrok.
5. Muestra la URL pública (ej: `https://abc-123.ngrok-free.app`) y la copia al portapapeles.

### 2.2. Actualizar el secret `VITE_API_URL` en GitHub

Importante: con **ngrok free** la URL del túnel cambia cada vez que reinicies el script. Cuando eso pase:

1. Copiar la URL nueva (el script ya la copió al portapapeles).
2. En github.com → repo → **Settings** → **Secrets** → editar `VITE_API_URL`.
3. Pegar la URL nueva → **Update secret**.
4. En la pestaña **Actions** → workflow "Deploy frontend a GitHub Pages" → botón **Run workflow** → branch `main` → **Run**.
5. Esperar ~2 minutos. Cuando termine (check verde), refrescar `https://TU-USUARIO.github.io/fwd-contable-ai/` y el contador puede usarlo.

> **Truco para evitar este paso**: ngrok pago ($8/mes) te da un dominio fijo (ej: `https://forward-contable.ngrok.app`). Lo configurás una vez y ya no tenés que actualizar el secret. Cloudflare Tunnel también es gratis con dominio fijo si tenés un dominio propio.

### 2.3. Listo

El contador entra a `https://TU-USUARIO.github.io/fwd-contable-ai/`, hace login y empieza a trabajar.

**Mantené abierta la ventana del script** mientras el contador esté usando el sistema. Si cerrás la ventana, se cae el backend y el túnel.

---

## Operación de mantenimiento

### Cambios en el código

- Cambios al **frontend** → `git push` a main → GitHub Actions construye y publica en 2 min.
- Cambios al **backend** → Ctrl+C en la ventana del script → `git pull` → re-arrancar el script.

### Backup de la base de datos

El SQLite vive en `backend/data/fwd-contable.db`. Para hacer backup manual:

```powershell
Copy-Item backend/data/fwd-contable.db "backups/fwd-contable-$(Get-Date -Format yyyyMMdd-HHmm).db"
```

Recomendado: agregar este comando como tarea programada de Windows (Task Scheduler) que corra todos los días.

### Logs

El script abre dos ventanas: backend y ngrok. Los logs están ahí. Si necesitás revisar a posteriori, podés redirigir el output del backend a un archivo modificando el script.

---

## Resolver problemas comunes

| Síntoma | Causa probable | Fix |
|---|---|---|
| GitHub Pages dice "404 — There isn't a GitHub Pages site here" | El workflow nunca terminó | Settings → Pages → ver si dice "Your site is live at..." |
| La página carga pero el login falla con "No se pudo conectar" | El secret `VITE_API_URL` está vacío o tiene la URL vieja | Actualizar secret + re-correr workflow |
| Frontend carga en blanco | El `VITE_BASE_PATH` no coincide con el nombre del repo | Verificar que el secret diga `/nombre-del-repo/` |
| El script de ngrok dice "ERR_NGROK_4018" | Ngrok no tiene authtoken configurado | `ngrok config add-authtoken TU_TOKEN` |
| El backend arranca pero `/health` no responde | El `.env` tiene algún valor mal formateado (ej: JWT_SECRET corto) | Mirar logs del backend; el zod schema rechaza al boot con mensaje claro |
| "Configuración inválida: JWT_SECRET es OBLIGATORIO en NODE_ENV=production" | Faltó setear JWT_SECRET en `.env` | Generarlo (sección 1.4) y setearlo |
| ngrok dice "tunnels limit exceeded" | Free tier solo permite 1 túnel activo a la vez | Cerrar instancias anteriores de ngrok (Task Manager) |

---

## Checklist de validación post-deploy

Una vez que el sitio esté arriba, hacé este smoke test:

- [ ] Abrir `https://TU-USUARIO.github.io/fwd-contable-ai/` desde un navegador en modo incógnito.
- [ ] Llegar a la pantalla de login (no a página en blanco).
- [ ] Iniciar sesión con `ADMIN_EMAIL` / `ADMIN_PASSWORD` del `.env`.
- [ ] Navegar a "Subir facturas" → ver la pantalla del dropzone.
- [ ] Subir uno de los PDFs de prueba en `backend/tests/fixtures/`.
- [ ] Verificar que el procesamiento termina sin error.
- [ ] Ir a "Facturas" → la factura recién subida debe aparecer.
- [ ] Ir a "Historial" → la misma factura con estado "Activa".
- [ ] Descargar el Excel de Caja Chica → abrir en Excel → debe verse el formato profesional con header morado.
- [ ] Cerrar sesión y volver a entrar → debe pedir las credenciales (no entra como DEV automáticamente — eso confirma que JWT_SECRET está activo).

Si los 9 puntos pasan, el deploy está confirmado funcional.
