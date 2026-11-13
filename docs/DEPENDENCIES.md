# Dependencias

## Extracción local de documentos (pendiente de instalación y auditoría)

La lectura local de PDF, DOCX, XLSX y PPTX usa `pdf-parse` 1.1.1, `mammoth` 1.8.0, `exceljs` 4.4.0 y `officeparser` 4.2.0. Se eligió `exceljs` porque las reglas permanentes de Bit prohíben el paquete `xlsx` (SheetJS). Las versiones están fijadas en `package.json`; la instalación debe hacerla el usuario después de revisar el lockfile y ejecutar `npm audit --omit=dev`. Este cambio no instala dependencias ni puede certificar todavía sus scripts, CPU, RAM o latencia en la Galaxy Book3.

El instalador NSIS empaqueta las dependencias de producción dentro de la aplicación. `npm run dist:installer` ejecuta primero `preflight:installer`, que rechaza el build si faltan paquetes o si `package-lock.json` no está sincronizado. La bóveda, los modelos personales y los datos de usuario no se incluyen en el instalador: se seleccionan o configuran en cada equipo.

## node-llama-cpp

Bit incorpora `node-llama-cpp` **3.20.0** para cargar los modelos GGUF locales mediante llama.cpp, sin Ollama ni un servicio HTTP. La versión está fijada exactamente y fue publicada hace más de 14 días al momento de esta modificación. Usa los binarios precompilados de Windows x64 y se configura con `gpu: false`, `build: "never"` y cuatro hilos como máximo para evitar compilaciones o descargas en el equipo final.

Es un módulo nativo: quien prepare el release debe revisar `package.json` y ejecutar manualmente `npm install`, seguido de `npm audit --omit=dev`. La instalación no se ejecutó como parte de este cambio; por lo tanto, ese audit y las mediciones en la Galaxy Book3 continúan pendientes antes de publicar.

## Voz (Python existente)

El dictado reutiliza `faster-whisper` y `sounddevice` declarados en `main/voice-sidecar/requirements.txt`; no agrega paquetes. El modelo faster-whisper debe estar presente localmente y elegirse desde Ajustes. La carga usa `local_files_only=True` y no descarga pesos.

**Bloqueo de instalación:** las versiones Python están fijadas, pero `requirements.txt` todavía no incluye hashes y el instalador no usa `pip --require-hashes`, como requiere `AGENTS.md`. No ejecute `scripts/setup-voice.ps1` hasta cerrar esa verificación de integridad; el entorno existente se utilizó solo para inspeccionar la firma instalada de faster-whisper. La aplicación tampoco ejecuta el instalador.
# Excepción transitiva de seguridad

- `@simple-git/argv-parser` `2.0.1`: override exacto para corregir GHSA-v5rq-49vh-5v5c arrastrada por `node-llama-cpp` 3.20.0. Publicada el 26 de septiembre de 2026, supera 14 días. No se importa desde Bit y no agrega scripts de instalación.
- `simple-git` `4.0.1`: override exacto para corregir GHSA-x6jw-m9v5-85vh, GHSA-g4wm-2vf7-vfgr y GHSA-858h-whjf-mvg5. Publicada el 25 de septiembre de 2026, supera 14 días. Bit inicia `node-llama-cpp` con `build: "never"`; el usuario instala los módulos nativos tras revisar el lockfile.
