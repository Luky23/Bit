# Dependencias

La Fase 3 agrega cero dependencias npm. Usa únicamente APIs estándar de Node.js y la API HTTP local de Ollama.

## Voz (Python existente)

El dictado reutiliza `faster-whisper` y `sounddevice` declarados en `main/voice-sidecar/requirements.txt`; no agrega paquetes. El modelo faster-whisper debe estar presente localmente y elegirse desde Ajustes. La carga usa `local_files_only=True` y no descarga pesos.

**Bloqueo de instalación:** las versiones Python están fijadas, pero `requirements.txt` todavía no incluye hashes y el instalador no usa `pip --require-hashes`, como requiere `AGENTS.md`. No ejecute `scripts/setup-voice.ps1` hasta cerrar esa verificación de integridad; el entorno existente se utilizó solo para inspeccionar la firma instalada de faster-whisper. La aplicación tampoco ejecuta el instalador.
