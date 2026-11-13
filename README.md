# Bit

Bit es un asistente de escritorio local y privado para Windows. Usa modelos GGUF directamente con `node-llama-cpp`, voz local y herramientas declaradas con validación, sandbox y auditoría.

La rama `main` es estable. Todo el desarrollo y las pruebas previas a una publicación se hacen en `preview`.

## Instalación rápida

Reemplace `<tag>` por una versión publicada, por ejemplo `v0.1.0`:

```powershell
irm https://raw.githubusercontent.com/Luky23/Bit/<tag>/install.ps1 | iex
```

El instalador no requiere administrador. Descarga únicamente desde el Release de GitHub, verifica el SHA256 antes de mover el ejecutable y conserva los datos en `%LOCALAPPDATA%\Bit\data`.

## Revisar el instalador antes de ejecutarlo

```powershell
Invoke-WebRequest https://raw.githubusercontent.com/Luky23/Bit/<tag>/install.ps1 -OutFile .\install-bit.ps1
notepad .\install-bit.ps1
powershell -NoProfile -ExecutionPolicy Bypass -File .\install-bit.ps1 -Version <tag>
```

## Verificar una descarga manual

```powershell
Get-FileHash .\Bit-Portable.exe -Algorithm SHA256
Get-Content .\Bit-Portable.exe.sha256
gh attestation verify .\Bit-Portable.exe --repo Luky23/Bit
```

El hash calculado debe coincidir exactamente con `Bit-Portable.exe.sha256`.

## Primer inicio y modelos

Bit detecta `.gguf` automáticamente en `data\models`, `userData\models` y las ubicaciones habituales de LM Studio, Hugging Face, GPT4All y Jan. No necesita que el usuario elija una carpeta; la selección manual queda como opción para ubicaciones poco comunes. La elección se guarda por rol: conversación, programación y visión. Si falta el modelo elegido, Bit avisa y utiliza uno disponible.

Las descargas opcionales de Qwen se inician únicamente desde Configuración, requieren confirmación, pasan por `net-gateway` y se aceptan solo si coinciden con el SHA256 fijado en el código.

## Aplicaciones y móviles

Bit descubre aplicaciones mediante los accesos locales del menú Inicio y puede abrir una coincidencia segura sin pedir una carpeta. También detecta almacenamientos externos con letra de unidad. Windows no expone los teléfonos conectados exclusivamente por MTP como rutas para Node/Electron; en ese caso Bit informa la limitación y no intenta eludirla con comandos del sistema.

## Modo pendrive

```powershell
npm run dist:dir
powershell -NoProfile -File .\scripts\make-usb.ps1 -Drive E:
```

El script copia la aplicación desempaquetada, crea `portable.flag` y `data\models`. Use exFAT o NTFS para modelos mayores de 4 GB. Consulte [docs/PENDRIVE.md](./docs/PENDRIVE.md).

## Desarrollo y verificación

Las dependencias nativas se instalan manualmente después de revisar `package.json`:

```powershell
npm install
npm run typecheck
npm run verify
npm start
```

## Publicar una versión

```powershell
git switch preview
npm run verify
git tag v0.1.0
git push origin v0.1.0
```

El workflow del tag ejecuta `npm ci`, verifica el proyecto, genera `Bit-Portable.exe`, publica su SHA256 y crea una atestación de procedencia.

## Seguridad

El instalador:

- usa TLS 1.2 y descarga binarios solo desde `https://github.com/Luky23/Bit/releases/`;
- verifica SHA256 antes de instalar;
- no solicita administrador, no cambia el Registro, Defender ni las políticas de ejecución;
- no instala Node, Git, Ollama ni modelos.

Bit mantiene `contextIsolation`, `sandbox` y una CSP estricta. Las búsquedas y aperturas locales se auditan sin confirmaciones repetitivas. Toda escritura, instalación, descarga o acción peligrosa requiere una decisión explícita. El contenido de pantalla, web, notas y archivos se trata como dato no confiable y no puede autorizar herramientas.

Más detalles: [privacidad](./docs/PRIVACY.md), [modelos](./docs/MODELS.md), [voz](./docs/VOICE.md) y [pantalla](./docs/SCREEN.md).
