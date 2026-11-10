# Dependencias

## node-llama-cpp

Bit incorpora `node-llama-cpp` **3.20.0** para cargar los modelos GGUF locales mediante llama.cpp, sin Ollama ni un servicio HTTP. La versión está fijada exactamente y fue publicada hace más de 14 días al momento de esta modificación. Usa los binarios precompilados de Windows x64 y se configura con `gpu: false`, `build: "never"` y cuatro hilos como máximo para evitar compilaciones o descargas en el equipo final.

Es un módulo nativo: quien prepare el release debe revisar `package.json` y ejecutar manualmente `npm install`, seguido de `npm audit --omit=dev`. La instalación no se ejecutó como parte de este cambio; por lo tanto, ese audit y las mediciones en la Galaxy Book3 continúan pendientes antes de publicar.

## Voz (Python existente)

El dictado reutiliza `faster-whisper` y `sounddevice` declarados en `main/voice-sidecar/requirements.txt`; no agrega paquetes. El modelo faster-whisper debe estar presente localmente y elegirse desde Ajustes. La carga usa `local_files_only=True` y no descarga pesos.

**Bloqueo de instalación:** las versiones Python están fijadas, pero `requirements.txt` todavía no incluye hashes y el instalador no usa `pip --require-hashes`, como requiere `AGENTS.md`. No ejecute `scripts/setup-voice.ps1` hasta cerrar esa verificación de integridad; el entorno existente se utilizó solo para inspeccionar la firma instalada de faster-whisper. La aplicación tampoco ejecuta el instalador.
# Excepción transitiva de seguridad

- `@simple-git/argv-parser` `2.0.1`: override exacto para corregir GHSA-v5rq-49vh-5v5c arrastrada por `node-llama-cpp` 3.20.0. Publicada el 26 de septiembre de 2026, supera 14 días. No se importa desde Bit y no agrega scripts de instalación.
- `simple-git` `4.0.1`: override exacto para corregir GHSA-x6jw-m9v5-85vh, GHSA-g4wm-2vf7-vfgr y GHSA-858h-whjf-mvg5. Publicada el 25 de septiembre de 2026, supera 14 días. Bit inicia `node-llama-cpp` con `build: "never"`; el usuario instala los módulos nativos tras revisar el lockfile.
