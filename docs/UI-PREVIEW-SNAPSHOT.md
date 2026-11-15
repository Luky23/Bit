# Instantánea de la interfaz antes de la prueba holográfica

- Fecha: 2026-11-15
- Rama: `preview`
- Estado: existían cambios locales sin commit; la instantánea conserva el estado completo de esos archivos antes de esta prueba.
- Ubicación local ignorada por Git: `.bit-ui-preview-snapshot/20261115-before-experimental/`

Archivos incluidos: `main/electron/index.html`, `main/electron/hud-tokens.css`, `main/electron/bit-theme.css`, `main/electron/response-cards.css`, `main/electron/message-editor.css`, `main/electron/core-animation.js`, `main/electron/workspace-context.mjs`, `main/electron/display-panel.html`, `main/electron/display-panel.js`, `main/electron/display-panel-preload.cjs`, `main/electron/display-manager.mjs`, `main/electron/preload.cjs` y `main/electron/main.mjs`.

La restauración debe copiar esos archivos desde la instantánea hacia sus rutas originales. No se debe restaurar el repositorio completo ni tocar los archivos funcionales que no forman parte de esta prueba.
