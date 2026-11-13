# Fase 0: Bit desde pendrive

Con las dependencias ya revisadas e instaladas por usted, en Windows ejecute
`npm.cmd run dist:dir` desde el repo para generar
`dist/win-unpacked/Bit.exe`. El build no incluye modelos privados. Para preparar
una unidad vacía, ejecute `powershell -File scripts/make-usb.ps1 -Drive E:`
(reemplace `E:` por la letra real). El script compila y copia el contenido a
`E:\Bit`, crea `portable.flag` y `data\models`. No sobreescribe una carpeta
`Bit` preexistente en la unidad.
El empaquetado usa la distribución local de Electron en `node_modules` y no
reinstala dependencias ni descarga Electron durante el build.

Al abrir el ejecutable empaquetado, Bit usa `data` junto a `Bit.exe` si existe
`portable.flag` o si el ejecutable está fuera de `LOCALAPPDATA`. Configuración,
auditoría, modelos y música quedan bajo `data`; sesión/caché, logs y volcados de
error tienen rutas propias dentro de `data`. En desarrollo se conserva el perfil
`Bit Preview` de AppData. No se crean accesos directos ni entradas de registro.

Copie los modelos `.gguf` que eligió a `data\models` antes de iniciar una charla.
El ejecutable empaquetado no necesita Node, Git ni Ollama en la PC destino.
La voz empaquetada requiere `voice-sidecar\piper-sidecar.exe` previamente
preparado; el repo actual no contiene ese binario. Sin él, Bit inicia y muestra
el error de voz, mientras el chat local sigue disponible con un GGUF.
El runtime de Visual C++ de los binarios nativos aún debe comprobarse en una
PC limpia; no se instala automáticamente.

El script avisa si la unidad usa FAT32: un archivo individual no puede superar
4 GB. Para modelos grandes, use exFAT o NTFS. Compruebe en una segunda PC que
se crean `data\config.json`, `data\audit.log` y `data\session`, y que el
perfil del usuario de esa PC no recibe datos de Bit.
