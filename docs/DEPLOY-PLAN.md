# Plan de deploy para demos del taller

> Decisiones tomadas con el usuario. Este documento es la fuente de verdad para Fase 4 (frontend + GitHub Pages) y Fase 5 (túnel + pulido). Si algo de acá entra en conflicto con CLAUDE.md, gana lo de acá para temas de deploy.

---

## 1. Arquitectura del deploy

```
[Profesor / evaluador] ───── HTTPS ─────▶ https://torme.github.io/<repo-name>/
                                                      │
                                                      │ fetch (CORS)
                                                      ▼
                                          https://<dominio-fijo>.ngrok-free.app
                                                      │
                                                      │ HTTP local
                                                      ▼
                                          PC del usuario (localhost:3000)
                                                      │
                                          Node.js + Express + Agent SDK + SQLite
                                                      │
                                                      ▼
                                          Google Sheets + Hacienda CR (públicos)
```

## 2. Decisiones cerradas

### Túnel: Ngrok con dominio reservado

- **Por qué ngrok y no Cloudflare Tunnel**: el usuario ya tiene cuenta ngrok.
- **Plan**: usar 1 static domain gratis (incluido en el free tier de ngrok desde Aug 2023). Esto da una URL fija que NO cambia entre reinicios.
- **Setup en Fase 5**:
  1. `ngrok config add-authtoken <token>` con el token de la cuenta del usuario.
  2. Reservar dominio gratis en `https://dashboard.ngrok.com/domains`. Nombre sugerido: `fwd-contable.ngrok-free.app` o similar.
  3. Arrancar con `ngrok http 3000 --domain=fwd-contable.ngrok-free.app`.
  4. Confirmar que NO aparece la pantalla intersticial. Si aparece, agregar header `ngrok-skip-browser-warning: true` en los fetch del frontend (workaround).

### CORS: configurable vía .env, se agrega en Fase 4

- **Hoy (hasta Fase 4)**: el backend solo acepta `http://localhost:5173`. No tocar.
- **Cuando arme el frontend (Fase 4)**: agregar variable `CORS_ALLOWED_ORIGINS` al `.env` con formato CSV:

  ```
  CORS_ALLOWED_ORIGINS=http://localhost:5173,https://torme.github.io,https://fwd-contable.ngrok-free.app
  ```

  El `server.ts` debe leerla, hacer `.split(',')` y configurar `cors({ origin: [...] })`.

### Exposición pública: solo durante revisión

- **Día a día**: túnel apagado. Todas las demos se hacen en `localhost:5173` + `localhost:3000`.
- **Día de revisión del profesor**:
  1. Encender backend: `cd backend; npm run dev`.
  2. Encender túnel: `ngrok http 3000 --domain=fwd-contable.ngrok-free.app`.
  3. Pasarle al profesor el link de GitHub Pages.
  4. Cuando termine, apagar ambos (`Ctrl+C` × 2).
- **Riesgo aceptado**: durante la ventana de revisión, cualquiera con la URL puede hacer requests al backend (no hay JWT hasta Fase 3). Aceptable porque la ventana es corta y los datos son de prueba.

## 3. Frontend deploy (Fase 4)

### Configuración de Vite

`frontend/vite.config.ts`:

```ts
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  base: '/fwd-contable-ai/',   // <-- nombre del repo GitHub
  build: {
    outDir: 'dist',
  },
});
```

### Variable de entorno del frontend

`frontend/.env.production`:

```
VITE_API_URL=https://fwd-contable.ngrok-free.app
```

`frontend/.env.development`:

```
VITE_API_URL=http://localhost:3000
```

Vite levanta la correcta según el modo (`npm run dev` vs `npm run build`).

### Deploy automático con GitHub Actions

Crear `.github/workflows/deploy-frontend.yml` que:
1. Trigger en push a `main` que toque `frontend/**`.
2. `npm ci` en frontend.
3. `npm run build`.
4. Deploy `frontend/dist/` a la rama `gh-pages` o usar el action oficial `actions/deploy-pages`.

Activar GitHub Pages en Settings → Pages → Source: "GitHub Actions".

## 4. Script para encender la demo (Fase 5)

Crear `start-demo.bat` en la raíz del proyecto que abra dos terminales:

```bat
@echo off
echo Levantando backend...
start "Backend" cmd /k "cd backend && npm run dev"

echo Esperando 5 segundos a que el backend arranque...
timeout /t 5 /nobreak >nul

echo Levantando ngrok...
start "Ngrok" cmd /k "ngrok http 3000 --domain=fwd-contable.ngrok-free.app"

echo Listo. URL pública: https://fwd-contable.ngrok-free.app
echo Frontend: https://torme.github.io/fwd-contable-ai/
echo Cerrá ambas terminales para apagar la demo.
pause
```

## 5. Lo que NO entra en este plan

- **Backend deployado a Easypanel**: descartado por ahora porque el Claude Agent SDK con auth Max plan solo funciona en la PC del usuario. Si en el futuro se quiere deploy 24/7, hay que migrar a `ANTHROPIC_API_KEY` paga.
- **HTTPS propio para el backend**: ngrok ya da HTTPS, no hace falta certificado.
- **Auth pública sin JWT**: NO se expone el túnel a internet hasta que Fase 3 (JWT) esté completa, salvo durante la ventana corta de revisión del profesor.

## 6. Costos

- Frontend (GitHub Pages): $0
- Backend (PC del usuario): $0
- Túnel (ngrok free tier con static domain): $0
- Claude Agent SDK: $0 (Max plan del usuario)
- Google Sheets API: $0 (free tier)
- Hacienda CR API: $0 (pública)

**Total: $0/mes**. Mantenido en la lista de restricciones duras del proyecto.

## 7. Implicaciones para el Claude que ejecute Fase 4

Cuando arranque Fase 4, debe:

1. Leer este archivo antes de configurar el frontend.
2. Aplicar el `base` y las variables `VITE_API_URL` como dice acá.
3. Agregar `CORS_ALLOWED_ORIGINS` al `.env.example` del backend y leerlo en `server.ts`.
4. Crear el workflow de GitHub Actions descrito.
5. NO exponer el backend públicamente hasta que Fase 3 (JWT) esté lista. El túnel se levanta manualmente solo para demos.
