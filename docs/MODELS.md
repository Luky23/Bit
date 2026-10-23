# Modelos y roles

Bit separa el rol de cada modelo de su etiqueta concreta:

- `fastModel`: charla, voz, saludos, resúmenes y recordatorios.
- `model`: código, documentos, páginas web, planes y solicitudes de razonamiento.
- `visionModel`: pantalla, solo bajo demanda.
- `embedModel`: embeddings opcionales, solo local.

Los valores iniciales son configurables (`qwen3:4b-instruct` y `qwen3:14b`). El tag exacto debe confirmarse en la instalación local con `ollama list` o `/api/tags`; Bit no descarga nada automáticamente.

`think` es falso por defecto. El razonamiento se mantiene separado de la respuesta y nunca se muestra ni se envía a voz.
