# Modelos y roles

Bit separa el rol de cada modelo de su etiqueta concreta:

- `fastModel`: charla, voz, saludos, resúmenes y recordatorios.
- `model`: código, documentos, páginas web, planes y solicitudes de razonamiento.
- `visionModel`: pantalla, solo bajo demanda.
- `embedModel`: embeddings opcionales, solo local.

Los valores iniciales configurables son `qwen2.5:3b` para el rol rápido y `qwen2.5-coder:7b` para el rol pesado/programación. El tag exacto puede confirmarse en la instalación local con `ollama list` o `/api/tags`; Bit no descarga nada automáticamente.

`think` es falso por defecto. El razonamiento se mantiene separado de la respuesta y nunca se muestra ni se envía a voz.
