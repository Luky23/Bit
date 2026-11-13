# Conversación y memoria local

## Cambios

- Instrucciones para conversar con naturalidad, ajustar explicaciones y tener en cuenta correcciones dentro del contexto.
- Historial de hasta 20 mensajes, 2000 caracteres por mensaje y 16000 caracteres en total, priorizando lo reciente. No se guarda automáticamente el historial.
- Recuperación automática en turnos conversacionales de hasta cuatro notas guardadas en `Bit/Conversaciones` de la bóveda configurada. Examina como máximo 256 entradas, ordena por nombre descendente (los guardados comienzan con fecha), lee notas de hasta 16 KiB y entrega hasta 6000 caracteres. No es búsqueda semántica y puede omitir recuerdos antiguos.
- Lectura mediante la validación de rutas de ObsidianVault; auditoría sin contenido de notas. La memoria es dato externo no confiable. En turnos con intención de herramientas no se precarga: se conserva el flujo explícito de buscar/leer y guardar con confirmación.
- Sin dependencias, descargas, modelos nuevos ni entrenamiento del modelo. La adaptación permanente depende de recuerdos guardados explícitamente por el usuario.

## Validación del 11 de noviembre de 2026

`npm.cmd run typecheck`: correcto. Se usa el lanzador `.cmd` porque PowerShell bloquea `npm.ps1` por su política de ejecución.

Cuatro pruebas nuevas correctas en `main/tests/conversation-memory.test.mjs`: recuperación confinada y auditada, ampliación del historial, inyección como dato no confiable sin precarga antes de guardar y límites de contexto/roles.

`npm.cmd run verify`: 337 pruebas, 315 correctas, 21 fallidas y una omitida. **Fase sin cerrar.** El repositorio tenía numerosos cambios sin confirmar al comenzar; no se revirtieron. No se ejecutó una línea base completa antes del cambio, por lo que no se atribuyen categóricamente todos los fallos al estado anterior.

Fallos observados, fuera de la implementación de memoria:

- Prompt liviano: espera `keep_alive: "15m"`, recibe `"0"`; ese parámetro no se modificó en esta tarea.
- Área y desplazamiento del chat principal y del overlay (dos pruebas).
- Núcleo estático al pensar.
- Integración de núcleo, chat, telemetría y entrada.
- Agrupación y persistencia de Ajustes.
- Detalle de errores en telemetría.
- Núcleo del overlay y RMS.
- Puentes CommonJS y privilegios.
- Volumen, duración y errores de canción de inicio.
- Precarga de Piper.
- Liberación del motor Llama al cerrar.
- Correspondencia de canales IPC.
- Correspondencia de eventos del preload.
- Tokens visuales compartidos.
- Fallback cuando OCR no produce texto.
- Activación y configuración de Piper.
- Cola de voz y RMS en ambos núcleos.
- Dictado y transcripción editable.
- Resolución del sidecar Piper empaquetado.
- Piper opcional y voz ONNX sin JSON.

## Checklist manual pendiente de ejecución

Estas comprobaciones requieren la aplicación y el modelo local; las pruebas automatizadas verifican solicitudes simuladas, no calidad lingüística ni audio real.

- Comparar respuestas reales antes y después: naturalidad, seguimiento de correcciones y referencias a turnos anteriores.
- Conectar una bóveda de prueba, solicitar guardar una preferencia, confirmar, reiniciar y comprobar que se usa en una conversación sencilla. Rechazar otro guardado y comprobar que no persiste.
- Medir CPU, RAM y latencia con el modelo actual y una bóveda representativa. No se afirman mejoras de rendimiento.
- Escuchar las respuestas con voz local. Esta tarea cambia instrucciones de texto; no modifica la síntesis de voz.
- Comprobar manualmente diálogos, cancelación, auditoría y bloqueo de escrituras tras leer contenido externo.
