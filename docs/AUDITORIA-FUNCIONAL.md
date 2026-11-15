# Auditoría funcional de Bit

Estado histórico al 2026-11-06; las fases recientes se detallan más abajo.
Rama: `preview`

## Resultado verificable

- En esa fecha: `npm run typecheck` validó 29 módulos ESM y `npm test` registró
  162 pruebas aprobadas.
- La apertura de cualquier aplicación, archivo, protocolo o pestaña requiere confirmación nativa.
- El manifiesto principal ya no contiene una clave `devDependencies` duplicada.

Las pruebas automáticas no sustituyen las comprobaciones manuales de micrófono, altavoces, cámara, pantalla, modelos GGUF ni apertura de documentos en aplicaciones reales de Windows.

## Comparación de verificación antes de Workspace

Comparación realizada el 2026-11-13 entre el `HEAD` anterior a los cambios locales
de Workspace (`37c62b0`) y el árbol de trabajo actual. El checkout original no se
modificó para esta comparación.

| Estado | Typecheck | Pruebas | Aprobadas | Fallidas | Omitidas |
|---|---:|---:|---:|---:|---:|
| Antes de Workspace | 49 módulos | 386 | 360 | 25 | 1 |
| Con Workspace | 49 módulos | 388 | 362 | 25 | 1 |
| Workspace + visor 3D | 49 módulos | 396 | 370 | 25 | 1 |
| Workspace holográfico + dock de comandos | 49 módulos | 398 | 372 | 25 | 1 |
| Reejecución actual (2026-11-14) | 49 módulos | 398 | 373 | 24 | 1 |
| Verificación final de esta sesión | 51 módulos | 431 | 406 | 24 | 1 |

El registro conservado [verify-last.log](../verify-last.log), anterior a la
reejecución, muestra 386 pruebas: 361 aprobadas, 24 fallidas y una omitida;
difiere en una aprobación/fallo de la tabla histórica del 2026-11-13.

La línea base del 2026-11-13 registró 25 fallos. En la verificación final de
esta sesión, `npm.cmd run verify` pasa el typecheck con 51 módulos y registra
431 pruebas: 406 aprobadas, 24 fallidas y una omitida; la verificación completa
sigue sin aprobarse. Las 20 pruebas enfocadas en distribución de pantallas,
Workspace, sus puentes y proyectos pasan. El caso anterior de visibilidad del
overlay fue reemplazado por una prueba de alternancia Bit/Workspace en una
pantalla, que ahora pasa. El fallo concurrente de `downloader.test.mjs` aparece
en esta ejecución y no en `verify-last.log`; también falla al ejecutarse
aisladamente. El módulo downloader no forma parte de los cambios locales
revisados. Los fallos actuales se agrupan en áreas distintas de Workspace y
multimonitor, pero esta ejecución no establece una comparación limpia de todo
el árbol, por lo que no se atribuyen causas ni se afirma que cada fallo sea
idéntico al de la línea base. No se hallaron fallos en los casos enfocados de
Workspace/monitores.

Fallos preexistentes:

- `agent.test.mjs`: 2 (prompt liviano y límite de rondas).
- `chat-scroll.test.mjs`: 3 (desplazamiento del chat y animación del núcleo).
- `downloader.test.mjs`: 1 (descargas concurrentes).
- `main-window.test.mjs`: 3 (estructura visual, ajustes y diagnóstico).
- `overlay.test.mjs`: 1 (núcleo holográfico y RMS); la prueba de
  `overlay-visibility.test.mjs` actualizada pasa.
- `preload.test.mjs`: 6 (preloads, arranque, cierre, canales IPC y eventos).
- `release.test.mjs`: 1 (tokens visuales).
- `screen-analysis.test.mjs`: 1; intenta acceder a Ollama en
  `127.0.0.1:11434`; el servicio no está disponible en este entorno y la
  prueba termina con `fetch failed` en vez del rechazo esperado.
- `ui-encoding.test.mjs`: 1.
- `voice-autoreply.test.mjs`: 3.
- `voice.test.mjs`: 2.

El historial previo y la reejecución actual muestran que los fallos pendientes
están fuera de los nuevos casos de Workspace/monitores; la discrepancia del
registro histórico y el fallo actual del downloader impiden afirmar que todos
los fallos actuales sean exactamente los mismos del baseline. Esta auditoría no
determina la causa raíz de cada fallo preexistente. La interacción visual,
hardware multimonitor, voz real y modelos locales requieren además la checklist
manual; no se validaron en esta ejecución.

## Estado por función

| Función solicitada | Estado | Evidencia y límite actual |
|---|---|---|
| Conversación escrita | Implementada, pendiente de prueba manual | Enrutamiento GGUF local entre los roles de conversación y programación, contexto acotado y respuestas en español. Falta instalar manualmente el módulo nativo y medir latencia y RAM en el equipo objetivo. |
| Voz de entrada | Implementada, pendiente de prueba manual | Dictado local mediante `faster-whisper`, pulsar-para-hablar y transcripción editable. La instalación nueva permanece bloqueada hasta fijar hashes de Python. |
| Voz de salida | Implementada, pendiente de prueba manual | Piper local, respuesta por oraciones e interrupción. Requiere modelo local elegido por el usuario. |
| Activación por nombre | No implementada | Existe una opción de configuración, pero no un detector conectado y medido. Debe compararse STT por ráfagas, detector local y atajo con CPU, RAM, aciertos y falsos positivos. |
| Activación por aplauso | No implementada | Solo está en la hoja de ruta. No debe quedar escuchando permanentemente hasta medir consumo y falsos positivos. |
| Sonido de inicio | Implementado con archivo local | Se elige, copia y reproduce un fragmento local con volumen y atenuación. La propuesta de sonido predeterminado es una campanilla breve de dos tonos, generada localmente y sin archivo descargado; todavía no está implementada. |
| Interfaz visual | Implementada | Ventana principal Electron y HUD superpuesto, ajustes locales, chat y núcleo visual. Pendiente de prueba manual de accesibilidad y DPI real. |
| Abrir aplicaciones | Implementada con lista blanca | No admite shell libre. Toda apertura o ejecución solicita confirmación nativa y queda limitada a objetivos validados. |
| Ejecutar comandos | Restringida por diseño | No habrá PowerShell o `cmd` libre. Las acciones se exponen como herramientas declaradas, validadas y auditadas. |
| Gestionar proyectos y archivos | Implementada parcialmente | Crea proyectos y archivos de texto, lee, modifica, respalda y restaura dentro de una raíz elegida. Falta búsqueda general segura de archivos y entrega de binarios. |
| Visor 3D del Workspace | Implementado con límites documentados; falta prueba visual real | Importa STL, OBJ, GLB y glTF 2.0 locales, renderiza en Canvas 2D, con rotación, zoom, paneo, vistas, selección/visibilidad, modos sólido/wireframe/holograma y explosión de componentes separados. Lee solo desde proyectos elegidos; tope 64 MiB/200.000 triángulos. Muestra dimensiones, recuentos y visibilidad derivados de la geometría cargada. El dock del Workspace envía comandos al chat local existente y presenta sus respuestas; las herramientas de BIT controlan el visor y reciben resultado. No soporta Draco, accessors sparse, morph targets ni texturas PBR. Falta abrir archivos reales y medir CPU/RAM en Windows. |
| Programar | Implementada parcialmente | Puede crear y editar código como texto dentro de proyectos. Por seguridad, Bit no ejecuta los archivos generados. |
| HTML | No implementado como artefacto validado | Hoy puede guardarse texto, pero falta el renderizador determinista, CSP, validador y entrega versionada. |
| PDF | No implementado | Está diseñado sobre HTML aislado y `printToPDF`, sin dependencia nueva. |
| Word (`.docx`) | No implementado | Requiere decidir y auditar una biblioteca o implementar Open XML con los recursos ya disponibles. |
| Excel (`.xlsx`) | No implementado | Nunca se usará el paquete npm `xlsx`. Faltan renderizador, fórmulas de lista blanca y validación ZIP/Open XML. |
| PowerPoint (`.pptx`) | No implementado | Faltan layouts 16:9, notas, renderizador y validación ZIP/Open XML. |
| Archivos Python | Parcial | Puede escribir `.py` como texto en proyectos; no lo ejecuta. Falta empaquetado de entrega con README y pruebas. |
| Memoria en grafo | Implementada | Bóveda Obsidian local, carpeta propia `Bit/`, índice, enlaces, backlinks, grafo y escritura con confirmación. Pendiente de prueba con una copia de una bóveda real. |
| Visión de pantalla | Implementada, pendiente de prueba manual | Captura bajo permiso y análisis local con el modelo de visión configurado. Falta verificar pantalla real, varios monitores y rendimiento de LLaVA 7B en CPU. |
| Cámara | Incompleta | Hay IPC y permisos parciales, pero la herramienta del agente aún devuelve “no implementada”. Se mantiene para una fase posterior. |
| Web | Implementada parcialmente | Búsqueda y clima pasan por `net-gateway`, con indicador y auditoría. Falta lectura completa de páginas. |
| Notion y Google Calendar | No implementados | Solo figuran en el diseño. Deben ser de solo lectura, usar secretos cifrados y salir únicamente por `net-gateway`. |
| Botón de emergencia | No verificado | Debe comprobarse globalmente `Control+Alt+Esc`; no se considera cerrado hasta una prueba manual. |

## Bloqueos que no deben ocultarse

1. `main/voice-sidecar/requirements.txt` fija versiones pero todavía no contiene hashes. Por la política del proyecto, no se debe ejecutar una instalación nueva hasta generar y revisar un archivo compatible con `pip --require-hashes`.
2. La descarga automática del catálogo Piper permanece deshabilitada hasta fijar hashes oficiales; las voces locales elegidas manualmente siguen disponibles.
3. No hay mediciones reales de CPU, RAM y latencia de Qwen 2.5 3B, Qwen 2.5 Coder 7B, LLaVA 7B, STT ni detectores de activación en la Galaxy Book3.
4. Las funciones documentales todavía no existen como herramientas de entrega; no se debe afirmar al usuario que un Word, Excel, PowerPoint o PDF fue creado.

## Orden recomendado de cierre

1. Integridad de voz: hashes, instalación manual revisada y prueba de micrófono/Piper.
2. Entregas: carpeta elegida, versionado y manifiesto `.bit.json`.
3. HTML seguro y luego PDF, ambos sin dependencias nuevas.
4. Word, Excel y PowerPoint, una biblioteca por vez y solo después de auditoría de versión, antigüedad y vulnerabilidades.
5. Búsqueda local de archivos y empaquetado de proyectos, sin ejecución automática.
6. Medición de activación por nombre y aplauso; adoptar únicamente la alternativa que cumpla los límites del equipo.
7. Notion y Calendar de solo lectura mediante `net-gateway`.
8. Cámara y señalamiento visual, con consentimiento y prueba manual.

## Ejecución musical y herramientas de Windows

La orden directa de música, escrita o transcripta por voz, se resuelve antes de
consultar al modelo y llega al mismo ejecutor `media.play_music`. La búsqueda y
apertura web pasan por `net-gateway`; se filtran resultados irrelevantes y se
elige una canción automáticamente, priorizando publicaciones oficiales. YouTube
abre el enlace directo del video con `autoplay=1`; Spotify abre el enlace directo
de la pista cuando Bing devuelve uno. Si no se encuentra una pista válida, Bit
informa el error en vez de dejar al usuario frente a una lista de resultados.
Se respeta la plataforma explícita, se prueba Chrome y luego navegadores
alternativos disponibles, y la ejecución está limitada a tres intentos de hasta
12 segundos. La autorización sigue pasando por la política central de permisos.

Los modos de selección son Popular (predeterminado), Reciente y Aleatorio. La
popularidad y las fechas solo se usan si aparecen en los datos de búsqueda; sin
esos datos se elige por relevancia y Bit no afirma que sea la más escuchada ni la
más reciente. «Poné otra», «Siguiente», «lo último» y «algo más nuevo» reutilizan
el artista y la pista de la sesión cuando están disponibles. Las preferencias de
plataforma, modo, navegador, artistas y géneros se guardan en la configuración
local y se pueden cambiar desde Ajustes.

La apertura del navegador externo no permite leer el estado del reproductor:
Bit informa que intentó reproducir, pero no afirma éxito sin una señal verificable.
Spotify se abre mediante Spotify Web; no se controla ni se verifica la aplicación
de escritorio, la autenticación o el inicio de sesión. Los controles de pausa,
reanudación, anterior, volumen y silencio siguen sin una integración multimedia
verificada y devuelven un error explícito. No se realizó una prueba real de
reproducción en Windows; el autoplay, la disponibilidad de resultados, la
autenticación y los permisos de la plataforma requieren comprobación manual.

En esta actualización, `npm run typecheck` importó correctamente 51 módulos ESM.
Las pruebas enfocadas de música, navegación y gateway pasaron (48/48).
`npm run verify` registró 429 pruebas: 403 aprobadas, 25 fallidas y 1 omitida.
Las 24 fallas conocidas siguen presentes. También falló de forma aislada y
reproducible una aserción preexistente de `projects.test.mjs`: espera que
`readFile` no incluya `size` ni `modifiedAt`, aunque `workspace.mjs` los devuelve.
Ese módulo no se modificó en esta corrección. Las pruebas nuevas de selección
musical y enlaces directos pasaron. No se hizo una prueba real de reproducción
con un navegador visible.

## Etapa contextual verificada — 2026-11-15

- Se corrigieron textos visibles recodificados en `main/electron/index.html`; el test de encoding pasa 1/1.
- La interfaz real de BIT expone el núcleo, saludo, conversación, voz, `Configuración` y el modo experimental mediante Computer Use.
- Se confirmó por árbol de accesibilidad que el arranque no muestra un panel de proyecto activo sin contexto.
- Se ajustó `main/tests/display-layout.test.mjs` para verificar que el panel se crea al entrar al Workspace, no antes.
- Pasan las 38 pruebas enfocadas de archivos soltados, navegación, Workspace, multimonitor, transiciones y visor 3D.
- `npm run typecheck` pasa con 53 módulos ESM.
- `npm run verify` registra 462 pruebas: 439 aprobadas, 22 fallidas y una omitida; los fallos son preexistentes y están fuera de esta etapa, por lo que no se declara verificación global aprobada.
- Pendiente manual: escribir y enviar una conversación, adjuntar un archivo real, aceptar permisos nativos, abrir un modelo 3D real y validar rotación/zoom con captura visual fiable. Computer Use detectó entrada del usuario durante la escritura y su captura nativa apuntó a VS Code; no se inventa esa evidencia.
- Incidencia visual reportada por el usuario: ventana con encabezado y medidor de micrófono, pero sin núcleo, chat ni compositor. Se añadió `spatial-visibility-guard` en `main/electron/index.html`, acotado al modo experimental, con núcleo CSS de respaldo y visibilidad forzada de conversación/compositor. Requiere confirmación visual del usuario después del reinicio.
- Causa raíz confirmada en la captura abierta desde VS Code: `.conversation` tenía `0px` de ancho por la composición experimental heredada. La corrección final fija el contenedor al viewport con `width: 100vw`, `max-width: none` y `margin: 0`; la captura posterior muestra núcleo, saludo, conversación y controles.

