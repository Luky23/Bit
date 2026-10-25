<#
.SYNOPSIS
    Configura el entorno de voz local de Bit (Piper TTS + Silero VAD + faster-whisper STT).

.DESCRIPTION
    Este script crea un entorno virtual Python en main/voice-sidecar/.venv,
    instala las dependencias con hashes fijados (requirements.lock) y descarga
    los modelos necesarios. NO ejecuta código automático desde la app; el usuario
    debe revisar y ejecutar este script manualmente.

.NOTAS
    - Requiere Python 3.10+ instalado y en PATH.
    - Los modelos de voz (.onnx, .json) NO se incluyen en el repo; deben colocarse
      manualmente en %LOCALAPPDATA%\Bit\voices\ tras la instalación.
    - Silero VAD: descargar silero_vad.onnx de https://github.com/snakers4/silero-vad
    - Piper: descargar modelos .onnx/.json de https://huggingface.co/rhasspy/piper-voices
    - faster-whisper: los modelos se descargan automáticamente a la cache de HuggingFace
      la primera vez que se usan (small/base para CPU).
#>

param(
    [switch]$ForceRecreate
)

$ErrorActionPreference = "Stop"

Write-Host "=== Configuración de Voz Local de Bit (Fase 4) ===" -ForegroundColor Cyan
Write-Host ""

# Rutas
$repoRoot = Split-Path -Parent $PSScriptRoot
$voiceSidecarDir = Join-Path $repoRoot "main" "voice-sidecar"
$venvDir = Join-Path $voiceSidecarDir ".venv"
$pythonExe = Join-Path $venvDir "Scripts" "python.exe"
$pipExe = Join-Path $venvDir "Scripts" "pip.exe"
$requirementsLock = Join-Path $voiceSidecarDir "requirements.lock"
$voicesDir = Join-Path $env:LOCALAPPDATA "Bit" "voices"

# Verificar Python
Write-Host "Verificando Python..." -ForegroundColor Yellow
$pythonVersion = python --version 2>&1
if ($LASTEXITCODE -ne 0) {
    Write-Error "Python no encontrado en PATH. Instalá Python 3.10+ desde python.org"
    exit 1
}
Write-Host "  Encontrado: $pythonVersion" -ForegroundColor Green

# Crear/recrear entorno virtual
if (Test-Path $venvDir -and $ForceRecreate) {
    Write-Host "Eliminando entorno virtual existente..." -ForegroundColor Yellow
    Remove-Item $venvDir -Recurse -Force
}

if (-not (Test-Path $venvDir)) {
    Write-Host "Creando entorno virtual en $venvDir..." -ForegroundColor Yellow
    python -m venv "$venvDir"
    if ($LASTEXITCODE -ne 0) {
        Write-Error "Falló la creación del entorno virtual"
        exit 1
    }
} else {
    Write-Host "Entorno virtual ya existe. Usá -ForceRecreate para recrearlo." -ForegroundColor Yellow
}

# Actualizar pip
Write-Host "Actualizando pip..." -ForegroundColor Yellow
& $pipExe install --upgrade pip

# Instalar dependencias con hashes (requirements.lock)
if (Test-Path $requirementsLock) {
    Write-Host "Instalando dependencias desde requirements.lock..." -ForegroundColor Yellow
    & $pipExe install --require-hashes -r "$requirementsLock"
    if ($LASTEXITCODE -ne 0) {
        Write-Error "Falló la instalación de dependencias. Verificá requirements.lock"
        exit 1
    }
} else {
    Write-Warning "No se encontró requirements.lock, instalando versiones conocidas..."
    & $pipExe install "piper-tts==1.8.0" "faster-whisper==1.1.1" "onnxruntime==1.31.0" "numpy==2.5.4" "sounddevice==0.5.0"
}

# Crear carpeta de voces
Write-Host "Creando carpeta de voces en $voicesDir..." -ForegroundColor Yellow
New-Item -ItemType Directory -Force -Path $voicesDir | Out-Null

# Descargar modelo Silero VAD
$vadModelUrl = "https://github.com/snakers4/silero-vad/raw/master/src/silero_vad/data/silero_vad.onnx"
$vadModelPath = Join-Path $voicesDir "silero_vad.onnx"
if (-not (Test-Path $vadModelPath)) {
    Write-Host "Descargando modelo Silero VAD..." -ForegroundColor Yellow
    try {
        Invoke-WebRequest -Uri $vadModelUrl -OutFile $vadModelPath -UseBasicParsing
        Write-Host "  Silero VAD descargado en $vadModelPath" -ForegroundColor Green
    } catch {
        Write-Warning "No se pudo descargar Silero VAD automáticamente: $_"
        Write-Host "  Descargalo manualmente desde: $vadModelUrl" -ForegroundColor Yellow
        Write-Host "  Y colocalo en: $vadModelPath" -ForegroundColor Yellow
    }
} else {
    Write-Host "  Silero VAD ya existe en $vadModelPath" -ForegroundColor Green
}

# Instrucciones para modelos Piper
Write-Host "" -ForegroundColor Cyan
Write-Host "=== PRÓXIMOS PASOS MANUALES ===" -ForegroundColor Cyan
Write-Host ""
Write-Host "1. Modelos Piper TTS (español recomendado):" -ForegroundColor Yellow
Write-Host "   Visitá: https://huggingface.co/rhasspy/piper-voices/tree/main/es_ES" -ForegroundColor Gray
Write-Host "   Descargá: es_ES-davefx-medium.onnx y es_ES-davefx-medium.onnx.json" -ForegroundColor Gray
Write-Host "   Colocalos en: $voicesDir\" -ForegroundColor Gray
Write-Host ""
Write-Host "2. Verificar instalación:" -ForegroundColor Yellow
Write-Host "   $env:LOCALAPPDATA\Bit\voices\es_ES-davefx-medium.onnx" -ForegroundColor Gray
Write-Host "   $env:LOCALAPPDATA\Bit\voices\es_ES-davefx-medium.onnx.json" -ForegroundColor Gray
Write-Host "   $env:LOCALAPPDATA\Bit\voices\silero_vad.onnx" -ForegroundColor Gray
Write-Host ""
Write-Host "3. Probar sidecar manualmente:" -ForegroundColor Yellow
$testCmd = "`"$pythonExe`" `"$voiceSidecarDir\sidecar.py`" --model `"$voicesDir\es_ES-davefx-medium.onnx`" --config `"$voicesDir\es_ES-davefx-medium.onnx.json`""
Write-Host "   $testCmd" -ForegroundColor Gray
Write-Host "   Luego escribí: {\"type\":\"speak\",\"text\":\"Hola, soy Bit.\"}" -ForegroundColor Gray
Write-Host ""

Write-Host "=== Configuración completada ===" -ForegroundColor Cyan