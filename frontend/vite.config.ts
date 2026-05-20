import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// IMPORTANTE: este proxy DEBE incluir TODOS los prefijos de endpoints expuestos
// por el backend. Si falta uno, Vite devuelve index.html como fallback de la SPA
// y descargas binarias (Excel, PDF) llegan corruptas al navegador.
// Sincronizado con backend/src/server.ts -> API_PREFIXES.
const BACKEND = 'http://localhost:3001';

// Base path para GitHub Pages.
//   - En dev (npm run dev): siempre '/'
//   - En build (npm run build): toma VITE_BASE_PATH del env o cae a '/'
//
// Si el repo se sirve en https://usuario.github.io/fwd-contable-ai/, hay que
// setear VITE_BASE_PATH=/fwd-contable-ai/ antes del build, sino los assets
// (CSS/JS) cargan desde la raíz del dominio y la página queda en blanco.
//
// Si usás dominio propio (CNAME), dejá VITE_BASE_PATH=/ o no lo seteás.
// `process` no está tipado acá (frontend tsconfig sin @types/node) — casteamos.
const basePath =
  (globalThis as { process?: { env?: Record<string, string | undefined> } }).process?.env
    ?.VITE_BASE_PATH ?? '/';

export default defineConfig({
  base: basePath,
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      '/auth': BACKEND,
      '/chat': BACKEND,
      '/facturas': BACKEND,
      '/process-document': BACKEND,
      '/hacienda': BACKEND,
      '/adelantos': BACKEND,
      '/caja-chica': BACKEND,
      '/excel': BACKEND,
      '/admin': BACKEND,
      '/health': BACKEND,
      '/historial': BACKEND,
    },
  },
  build: {
    // Source maps para que ErrorBoundary muestre traces útiles en prod.
    sourcemap: true,
    // Avisar si algún chunk pasa de 500 KB; ayuda a detectar regresiones de tamaño.
    chunkSizeWarningLimit: 500,
  },
});
