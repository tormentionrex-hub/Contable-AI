# ============================================================
# FWD Contable AI — Backend (Dockerfile multi-stage)
# ============================================================
# Diseñado para deploy a Easypanel (self-hosted en la VPS del usuario).
#
# Decisión arquitectónica (Fase 5 — OPCIÓN A documentada en docs/DEPLOY.md):
#   La autenticación del Claude Agent SDK NO funciona dentro de un contenedor
#   sin sesión interactiva. La OPCIÓN A mantiene el backend corriendo en la PC
#   del usuario (con Claude Code Max plan activo localmente) y solo el FRONTEND
#   se hostea en Easypanel.
#
#   Este Dockerfile sigue existiendo para 2 escenarios:
#     1. OPCIÓN B (futuro): si en algún momento se contrata ANTHROPIC_API_KEY
#        paga, el contenedor funciona standalone — solo cambiar CLAUDE_AUTH_MODE.
#     2. OPCIÓN C (mismo host): si Easypanel corre en la misma máquina que el
#        usuario, podés montar ~/.claude/ como volumen y reusar la sesión local.
#
# Por default este Dockerfile NO instala el CLI de claude — lo agregás en runtime
# si vas con C montando el binario.
# ============================================================

# ------------------------------------------------------------
# Stage 1 — builder: instala dependencias (incluidas devDeps que tsx necesita)
# ------------------------------------------------------------
FROM node:24-alpine AS builder

WORKDIR /app

# Copia primero solo manifest para aprovechar el cache de Docker
COPY package.json package-lock.json ./

# Instalación reproducible (necesitamos tsx en runtime para `node --experimental-strip-types`
# y/o `tsx`. Mantenemos dev deps para tipos en tiempo de boot).
RUN npm ci --no-audit --no-fund

# Copia el código de producción
COPY tsconfig.json ./
COPY src ./src
COPY schemas ./schemas
COPY skills ./skills

# (Opcional) Fixtures de tests NO se copian en runtime — quedan solo en dev.
# El test suite se valida en CI, no dentro del contenedor.

# ------------------------------------------------------------
# Stage 2 — runtime: imagen final mínima
# ------------------------------------------------------------
FROM node:24-alpine AS runtime

# curl para HEALTHCHECK + tini para señales de proceso limpias
RUN apk add --no-cache curl tini

# Usuario no-root por seguridad
RUN addgroup -S fwd && adduser -S fwd -G fwd

WORKDIR /app

# Copia el árbol completo del builder (incluye node_modules ya resueltos)
COPY --from=builder --chown=fwd:fwd /app /app

# Directorios donde el motor escribe (deben ser volúmenes en Easypanel)
RUN mkdir -p /data /credentials \
    && chown -R fwd:fwd /data /credentials

USER fwd

# Variables por defecto que Easypanel sobreescribe vía .env / secrets
ENV NODE_ENV=production \
    PORT=3000 \
    DB_PATH=/data/fwd-contable.db \
    STORAGE_PATH=/data/storage \
    UPLOAD_PATH=/data/uploads

EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
    CMD curl -fsS http://localhost:3000/health || exit 1

# tini como PID 1 para reenviar SIGTERM correctamente a node (graceful shutdown)
ENTRYPOINT ["/sbin/tini", "--"]

# tsx ejecuta TypeScript directo en producción — eficiente porque ya está en node_modules.
# Si querés un build precompilado, agregar PASO 14 en el reporte y usar `node dist/server.js`.
CMD ["npx", "tsx", "src/server.ts"]
