# Apertura directa de aplicaciones y YouTube

Implementado en `preview`, el 11 de noviembre de 2026. La fase continúa abierta porque la verificación completa no está en verde.

## Comportamiento

- «Abrí YouTube» entrega la página principal al navegador predeterminado.
- «Poné Daddy Yankee en YouTube» abre la búsqueda correspondiente. No selecciona un video ni afirma haber iniciado la reproducción.
- «Abrí Word» o «Abrí Visual Studio Code» buscan una coincidencia en los accesos directos del menú Inicio del usuario y del sistema. No dependen de inferencia del modelo ni de que el ejecutable esté en PATH.
- «Poné música» elige Spotify. En esta fase abre la aplicación; no asegura que esté reproduciendo audio.
- «Abrí Chrome y buscá temperatura en Córdoba», «Buscá recetas en Firefox» y «Buscá en Google horarios del tren» abren resultados en el navegador indicado o en el predeterminado si se pide Google sin navegador. Los nombres admitidos para búsquedas directas son Chrome, Edge, Firefox y Brave.
- Una coincidencia ambigua devuelve nombres para que el usuario precise. Una aplicación ausente devuelve un error, sin afirmar que se abrió.

## Permisos y límites

Se reutilizan las herramientas y los esquemas de argumentos existentes. Las aperturas de YouTube y de aplicaciones descubiertas se cotejan con el pedido explícito del usuario en el proceso principal. Una imagen o contenido externo marcado en el turno no autoriza esas aperturas.

Las aplicaciones conocidas sin argumentos conservan su apertura segura. Otros ejecutables descubiertos y los accesos con argumentos requieren un diálogo nativo por apertura, sin aprobación permanente. Se comprueba el destino real antes y después de aprobar; se excluyen shells, intérpretes, scripts, el repositorio, los datos de Bit y archivos temporales. La cancelación global se vuelve a comprobar antes de abrir una aplicación descubierta.

El catálogo tiene un límite de 2000 entradas y ocho niveles, con caché de 30 segundos. Se admiten accesos `.lnk` que resuelvan a ejecutables locales en directorios de aplicaciones. No se garantiza compatibilidad con aplicaciones UWP sin destino ejecutable, aplicaciones portátiles sin acceso en Inicio ni accesos rotos.

Las direcciones de búsqueda se construyen en código y pasan por el gateway, que registra inicio, resultado e indicador visible. Se admiten el inicio y los resultados de Google, Bing y YouTube; las búsquedas directas usan Google. No se admiten direcciones arbitrarias ni reproducción automática. Se entrega la URL al navegador externo: el gateway no intercepta su tráfico posterior.

Una apertura o búsqueda explícita se coteja con el navegador y la URL exactos del pedido. Otra propuesta requiere un diálogo nativo por acción; rechazarlo impide abrir. El IPC del renderer utiliza la misma política y no puede declarar que recibió una autorización explícita. Un turno con contenido externo bloquea estas aperturas; los resultados de herramientas tampoco pueden autorizar una apertura posterior. Para búsquedas, el navegador se ejecuta con una única URL validada y sin shell; se ignoran los argumentos del acceso directo.

El inicio de un ejecutable espera el evento `spawn`; un error `ENOENT` ya no produce una confirmación falsa de apertura.

## Medición local

Reproducible con `node scripts/bench-fast-control.mjs`. No abre aplicaciones, no visita páginas y no usa modelos. Las herramientas del agente y la escritura de auditoría del catálogo se sustituyen por dobles durante esta medición.

| Medición | Resultado de una ejecución local |
| --- | ---: |
| Pedidos de prueba del detector | 90 000 |
| Despacho medio por pedido | 0,00378 ms |
| CPU acumulada del proceso durante el detector | 376 ms |
| RSS al iniciar la medición | 45,29 MiB |
| RSS al terminar detector y catálogo | 47,00 MiB |
| Lectura inicial del menú Inicio real | 40,33 ms |
| Consulta del catálogo con caché | 0,24 ms |
| CPU acumulada durante las dos consultas del catálogo | 47 ms |
| Diferencia de RSS durante las consultas del catálogo | 0,41 MiB |
| Llamadas al modelo en los nueve turnos de prueba | 0 |

Estas cifras describen el despacho y la lectura del catálogo. No representan el tiempo de carga del navegador, de Word, de Spotify ni de la respuesta hablada; tampoco son una comparación con una ejecución anterior del modelo real.

## Verificación

El test de apertura directa falló antes de la implementación porque el agente intentaba pasar por el modelo. Los tests específicos ahora cubren el despacho sin inferencia, ambigüedad, cancelación, destinos bloqueados, cambios del acceso directo durante el diálogo, errores de Windows, auditoría del gateway y fallos de inicio del proceso. Se usaron accesos y ejecutables ficticios: no se ejecutaron esos archivos.

`npm.cmd run typecheck` y la comprobación de sintaxis del proceso principal pasan. Las 25 pruebas específicas de apertura, búsqueda y permisos pasan. La última ejecución de `npm.cmd run verify` registró 327 pruebas: 304 aprobadas, 22 fallidas y una omitida. Incluye los 21 fallos observados antes de esta ampliación y una discrepancia adicional entre el texto meteorológico actual y el esperado por su prueba:

- `agent.test.mjs`: configuración de generación y `keep_alive` en respuestas simples.
- `agent.test.mjs`: el mensaje de ausencia de datos meteorológicos ya no coincide con la expresión esperada; no se llamó al modelo ni se inventó el clima.
- `chat-scroll.test.mjs`: área de chat principal, desplazamiento del overlay y animación del núcleo (3).
- `main-window.test.mjs`: integración de ventana, ajustes y errores de telemetría (3).
- `overlay.test.mjs`: núcleo holográfico y RMS.
- `preload.test.mjs`: puentes CommonJS, canción de inicio, precarga Piper, liberación Llama, handlers y emisores IPC (6).
- `release.test.mjs`: tokens de apariencia.
- `screen-analysis.test.mjs`: fallback OCR.
- `voice-autoreply.test.mjs`: configuración Piper, respuesta única con RMS y dictado (3).
- `voice.test.mjs`: sidecar empaquetado y voz ONNX sin JSON lateral (2).

No se modificaron esas áreas para hacer pasar la suite.

## Comprobaciones manuales pendientes

- Reiniciar Bit y probar «Abrí YouTube»; verificar navegador predeterminado, indicador y auditoría.
- Probar una búsqueda de YouTube; comprobar que Bit no afirma haber reproducido un video.
- Probar una búsqueda en Chrome y otra en Firefox o Edge, y verificar que usa el navegador solicitado.
- Probar una propuesta adicional de apertura; comprobar el diálogo nativo, su rechazo y que no existe aprobación permanente.
- Probar Word y otra aplicación instalada real, incluyendo una instalada por usuario.
- Probar una aplicación ausente, una ambigua y la cancelación del diálogo nativo.
- Probar Control+Alt+Esc durante una confirmación de apertura.
- Medir latencia real desde enviar el pedido hasta ver la aplicación y escuchar la respuesta.

No se verificaron visualmente esas interacciones ni la reproducción de audio en esta sesión.
