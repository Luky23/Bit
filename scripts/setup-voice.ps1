<#
.SYNOPSIS
    Configura el entorno de voz local de Bit (Piper TTS + faster-whisper STT).

.DESCRIPTION
    Este script crea un entorno virtual Python en main/voice-sidecar/.venv,
    e instala las dependencias declaradas. El usuario debe revisar y ejecutar
    este script manualmente. No descarga modelos de voz, VAD ni transcripcion.

.NOTAS
    - Requiere Python 3.10+ instalado y en PATH.
    - Los modelos de voz (.onnx, .json) NO se incluyen en el repo; deben colocarse
      manualmente en %LOCALAPPDATA%\Bit\voices\ tras la instalacion.
    - El modelo STT debe estar convertido para CTranslate2 y se selecciona desde Ajustes.
#>

param(
    [switch]$ForceRecreate
)

$ErrorActionPreference = "Stop"

Write-Host "=== Configuracion de Voz Local de Bit (Fase 4) ===" -ForegroundColor Cyan
Write-Host ""

# Rutas
$repoRoot = Split-Path -Parent $PSScriptRoot
$voiceSidecarDir = Join-Path (Join-Path $repoRoot "main") "voice-sidecar"
$venvDir = Join-Path $voiceSidecarDir ".venv"
$pythonExe = Join-Path (Join-Path $venvDir "Scripts") "python.exe"
$pipExe = Join-Path (Join-Path $venvDir "Scripts") "pip.exe"
$requirementsTxt = Join-Path $voiceSidecarDir "requirements.txt"
$voicesDir = Join-Path (Join-Path $env:LOCALAPPDATA "Bit") "voices"

# Verificar Python
Write-Host "Verificando Python..." -ForegroundColor Yellow
$pythonVersion = python --version 2>&1
if ($LASTEXITCODE -ne 0) {
    Write-Error "Python no encontrado en PATH. Instala Python 3.10+ desde python.org"
    exit 1
}
Write-Host "  Encontrado: $pythonVersion" -ForegroundColor Green

# Crear/recrear entorno virtual
if ((Test-Path $venvDir) -and $ForceRecreate) {
    Write-Host "Eliminando entorno virtual existente..." -ForegroundColor Yellow
    Remove-Item $venvDir -Recurse -Force
}

if (-not (Test-Path $venvDir)) {
    Write-Host "Creando entorno virtual en $venvDir..." -ForegroundColor Yellow
    python -m venv "$venvDir"
    if ($LASTEXITCODE -ne 0) {
        Write-Error "Fallo la creacion del entorno virtual"
        exit 1
    }
} else {
    Write-Host "Entorno virtual ya existe. Usa -ForceRecreate para recrearlo." -ForegroundColor Yellow
}

# Actualizar pip
Write-Host "Actualizando pip..." -ForegroundColor Yellow
& $pipExe install --upgrade pip

# Instalar dependencias desde requirements.txt (versiones fijadas, sin hashes)
Write-Host "Instalando dependencias desde requirements.txt..." -ForegroundColor Yellow
& $pipExe install -r "$requirementsTxt"
if ($LASTEXITCODE -ne 0) {
    Write-Error "Fallo la instalacion de dependencias. Verifica requirements.txt"
    exit 1
}

# Crear carpeta de voces
Write-Host "Creando carpeta de voces en $voicesDir..." -ForegroundColor Yellow
New-Item -ItemType Directory -Force -Path $voicesDir | Out-Null

# Instrucciones para modelos Piper
Write-Host "" -ForegroundColor Cyan
Write-Host "=== PROXIMOS PASOS MANUALES ===" -ForegroundColor Cyan
Write-Host ""
Write-Host "1. Modelos Piper TTS (espanol recomendado):" -ForegroundColor Yellow
Write-Host "   Coloca localmente es_ES-davefx-medium.onnx y su archivo .json" -ForegroundColor Gray
Write-Host "   Colocalos en: $voicesDir\" -ForegroundColor Gray
Write-Host ""
Write-Host "2. Transcripcion local (opcional):" -ForegroundColor Yellow
Write-Host "   Coloca un modelo faster-whisper convertido para CTranslate2 fuera del repo." -ForegroundColor Gray
Write-Host "   Selecciona la carpeta desde Ajustes; debe contener model.bin y config.json." -ForegroundColor Gray
Write-Host "   Bit no descarga modelos STT automaticamente." -ForegroundColor Gray
Write-Host ""
Write-Host "3. Verificar instalacion:" -ForegroundColor Yellow
Write-Host "   $env:LOCALAPPDATA\Bit\voices\es_ES-davefx-medium.onnx" -ForegroundColor Gray
Write-Host "   $env:LOCALAPPDATA\Bit\voices\es_ES-davefx-medium.onnx.json" -ForegroundColor Gray
Write-Host ""
Write-Host "4. Probar sidecar manualmente:" -ForegroundColor Yellow
$testCmd = "`"$pythonExe`" `"$voiceSidecarDir\sidecar.py`" --model `"$voicesDir\es_ES-davefx-medium.onnx`" --config `"$voicesDir\es_ES-davefx-medium.onnx.json`""
Write-Host "   $testCmd" -ForegroundColor Gray
# Usar comillas simples para el JSON en PowerShell
Write-Host '   Luego escribi: {"type":"speak","text":"Hola, soy Bit."}' -ForegroundColor Gray
Write-Host ""

Write-Host "=== Configuracion completada ===" -ForegroundColor Cyan