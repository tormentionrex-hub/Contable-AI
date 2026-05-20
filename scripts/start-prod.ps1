# ============================================================
# FWD Contable AI — Arranque en producción local (Windows)
# ============================================================
# Lanza el backend en modo producción + el túnel ngrok en una sola operación.
# Asume que ya hiciste el setup inicial (instalación, .env, ngrok config).
#
# Uso:
#   Click derecho sobre este archivo > "Ejecutar con PowerShell"
#   o desde una terminal:  pwsh -File scripts/start-prod.ps1
# ============================================================

$ErrorActionPreference = 'Stop'
$here = Split-Path -Parent $MyInvocation.MyCommand.Path
$root = Split-Path -Parent $here
$backend = Join-Path $root 'backend'

# ------------------------------------------------------------
# 1. Verificar requisitos
# ------------------------------------------------------------
Write-Host "FWD Contable AI - Arranque produccion local" -ForegroundColor Magenta
Write-Host ""

if (-not (Test-Path (Join-Path $backend '.env'))) {
    Write-Host "ERROR: no existe backend/.env" -ForegroundColor Red
    Write-Host "  Copiá backend/.env.example a backend/.env y configurá:" -ForegroundColor Yellow
    Write-Host "    JWT_SECRET=...   (generar con: openssl rand -base64 32)" -ForegroundColor Yellow
    Write-Host "    ADMIN_EMAIL=...   ADMIN_PASSWORD=..." -ForegroundColor Yellow
    Write-Host "    NODE_ENV=production" -ForegroundColor Yellow
    exit 1
}

if (-not (Get-Command ngrok -ErrorAction SilentlyContinue)) {
    Write-Host "ERROR: ngrok no está instalado o no está en el PATH" -ForegroundColor Red
    Write-Host "  Instalalo desde https://ngrok.com/download" -ForegroundColor Yellow
    Write-Host "  Después configurá el authtoken con:  ngrok config add-authtoken <tu-token>" -ForegroundColor Yellow
    exit 1
}

# ------------------------------------------------------------
# 2. Verificar que el backend está compilado
# ------------------------------------------------------------
$distExists = Test-Path (Join-Path $backend 'node_modules')
if (-not $distExists) {
    Write-Host "Instalando dependencias del backend..." -ForegroundColor Cyan
    Push-Location $backend
    npm install
    Pop-Location
}

# ------------------------------------------------------------
# 3. Arrancar backend en background
# ------------------------------------------------------------
Write-Host "Arrancando backend en http://localhost:3001 ..." -ForegroundColor Cyan
$env:NODE_ENV = 'production'
$backendProcess = Start-Process -PassThru -FilePath 'cmd' `
    -ArgumentList '/c', 'npm', 'run', 'dev' `
    -WorkingDirectory $backend `
    -WindowStyle Normal

Start-Sleep -Seconds 5

# ------------------------------------------------------------
# 4. Verificar que /health responde antes de exponer
# ------------------------------------------------------------
$healthOk = $false
for ($i = 0; $i -lt 12; $i++) {
    try {
        $r = Invoke-RestMethod -Uri 'http://localhost:3001/health' -TimeoutSec 2
        if ($r.status -eq 'ok') {
            $healthOk = $true
            Write-Host "  Backend respondio: status=$($r.status), schema=$($r.schema), db=$($r.db)" -ForegroundColor Green
            break
        }
    } catch {
        Start-Sleep -Seconds 2
    }
}

if (-not $healthOk) {
    Write-Host "ERROR: el backend no respondio /health en 30 segundos." -ForegroundColor Red
    Write-Host "  Mirá la ventana del backend para ver el error de arranque." -ForegroundColor Yellow
    exit 1
}

# ------------------------------------------------------------
# 5. Levantar tunel ngrok en background
# ------------------------------------------------------------
Write-Host ""
Write-Host "Levantando tunel ngrok..." -ForegroundColor Cyan
$ngrokProcess = Start-Process -PassThru -FilePath 'ngrok' `
    -ArgumentList 'http', '3001', '--log=stdout' `
    -WindowStyle Normal

Start-Sleep -Seconds 4

# ------------------------------------------------------------
# 6. Mostrar URL publica del tunel
# ------------------------------------------------------------
try {
    $api = Invoke-RestMethod -Uri 'http://127.0.0.1:4040/api/tunnels' -TimeoutSec 3
    $publicUrl = ($api.tunnels | Where-Object { $_.proto -eq 'https' } | Select-Object -First 1).public_url
    if ($publicUrl) {
        Write-Host ""
        Write-Host "=========================================================" -ForegroundColor Green
        Write-Host "  TUNEL ACTIVO" -ForegroundColor Green
        Write-Host "=========================================================" -ForegroundColor Green
        Write-Host ""
        Write-Host "  Backend publico:  $publicUrl" -ForegroundColor White
        Write-Host "  Backend local:    http://localhost:3001" -ForegroundColor Gray
        Write-Host ""
        Write-Host "  Para que el frontend en GitHub Pages hable con este backend:" -ForegroundColor Yellow
        Write-Host "    1. En el repo de GitHub, ir a Settings > Secrets > Actions" -ForegroundColor Yellow
        Write-Host "    2. Editar el secret VITE_API_URL = $publicUrl" -ForegroundColor Yellow
        Write-Host "    3. Re-ejecutar el workflow 'Deploy frontend' desde la pestana Actions" -ForegroundColor Yellow
        Write-Host ""
        # Copiar al clipboard para facilitar
        $publicUrl | Set-Clipboard
        Write-Host "  (URL copiada al portapapeles)" -ForegroundColor DarkGray
    }
} catch {
    Write-Host "No pude consultar la URL del tunel via API. Miralo en la ventana de ngrok." -ForegroundColor Yellow
}

# ------------------------------------------------------------
# 7. Esperar Ctrl+C para limpiar
# ------------------------------------------------------------
Write-Host ""
Write-Host "Mantene esta ventana ABIERTA mientras el contador este usando el sistema." -ForegroundColor Cyan
Write-Host "Presiona Ctrl+C para parar el backend y cerrar el tunel." -ForegroundColor Cyan
Write-Host ""

try {
    Wait-Process -Id $backendProcess.Id -ErrorAction SilentlyContinue
} finally {
    Write-Host ""
    Write-Host "Cerrando backend y tunel..." -ForegroundColor Yellow
    if ($backendProcess -and -not $backendProcess.HasExited) {
        Stop-Process -Id $backendProcess.Id -Force -ErrorAction SilentlyContinue
    }
    if ($ngrokProcess -and -not $ngrokProcess.HasExited) {
        Stop-Process -Id $ngrokProcess.Id -Force -ErrorAction SilentlyContinue
    }
    Write-Host "Listo. Hasta la proxima." -ForegroundColor Green
}
