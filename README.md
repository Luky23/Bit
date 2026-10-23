# Bit

Bit es un asistente personal local y privado para Windows.

## Canales

La rama Git `main` es el canal estable. La rama Git `preview` contiene el desarrollo en prueba. La carpeta `main/` contiene el código estable que compartirá el canal preview; `preview/` contiene funciones experimentales aisladas. Todo el trabajo de esta fase está en la rama `preview`.

Esta fase no descarga modelos. Los nombres y parámetros se editan desde la configuración y los modelos se administran por Ollama en `localhost`.

## Comandos

```text
npm run typecheck
npm test
npm run verify
npm run eval:models
```
