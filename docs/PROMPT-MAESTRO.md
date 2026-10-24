# PROMPT MAESTRO — Bit (reconstrucción por fases)

**Cómo se usa.** Este archivo va en `docs/PROMPT-MAESTRO.md` y las reglas permanentes en `AGENTS.md`. En cada sesión se pega solo el mensaje corto de abajo, cambiando el número de fase. El agente ejecuta **una sola fase por vez**.

```
Leé AGENTS.md y docs/PROMPT-MAESTRO.md. Ejecutá únicamente la FASE <N>.
Trabajá en la rama preview. No avances a otra fase. Al terminar, mostrame
typecheck y verify, y un reporte con lo que no pudiste verificar.
```

Empezar por la FASE 1 y seguir en orden: las fases dependen de las anteriores.

---

## 0. Qué se construye

Bit: asistente tipo Jarvis, local y privado, para Windows. Estilo formal y respetuoso, en español.

**Equipo:** Samsung Galaxy Book3 común, gráficos integrados, 16 GB de RAM. Todo se ejecuta en CPU.

**Modelos (Ollama), editables desde ajustes y nunca grabados en el código:**
- `fastModel`: Qwen2.5 3B, para charla, voz y tareas livianas.
- `model`: Qwen2.5-Coder 7B, para programar, páginas y documentos.
- `visionModel`: un modelo de visión chico, cargado solo cuando se pide (candidatos a medir; verificá qué hay en la biblioteca de Ollama, por ejemplo Qwen2.5-VL 3B o uno más chico).
- Verificá los tags exactos con `ollama list` y la biblioteca. Antes de fijar el tamaño del 3B y del 7B, revisá su licencia en la ficha del modelo.

**Presupuesto de memoria:** el 3B queda cargado; el 7B se carga bajo demanda; el de visión se carga solo, descargando el 7B. Nunca superar la RAM libre; medirlo y avisar.

**Lo que Bit hace:** habla y escucha; se despierta con "Bit" o "Bit, ¿estás despierto?"; al abrir muestra el resumen del día (Notion + Google Calendar); ve la pantalla y señala; maneja la compu; busca en internet y, si se lo pido, lee y resume la página (en voz alta, escrito, o ambas); crea Word, PowerPoint, Excel, PDF y HTML; programa; se conecta a mi bóveda de Obsidian.

**Decisiones fijas:**
- Autorización solo para lo peligroso o lo que modifica algo (regla 3 de AGENTS.md).
- Internet solo en los tres usos de la regla 1.
- Repo con dos ramas: `preview` (trabajo y pruebas) y `main` (estable). Sin carpetas `preview/`.
- Todo lo privado queda fuera del repo.

**Repo anterior de Bit:** está en `_referencia/` (solo lectura, en `.gitignore`). Se porta módulo por módulo lo ya auditado, cada uno con sus tests y pasando por la FASE 2. Si `_referencia/` no existe, avisá y pará.

---

## FASE 1 — Repositorio y flujo preview → main
1. Estructura en la raíz: `src/`, `tests/`, `scripts/`, `docs/` (ARCHITECTURE, SECURITY, PRIVACY, DEPENDENCIES, MODELS, SETTINGS, PROMOTION-CHECKLIST), `models-catalog.json`, `.github/workflows/ci.yml`, `AGENTS.md`, `CHANGELOG.md`, `README.md`, `.gitignore` estricto (modelos, bóveda, `userData`, `.env`, `dist`, `node_modules`, audio, tokens, capturas, registros, `_referencia/`).
2. **Dos canales de datos:** la compilación de `preview` se llama "Bit Preview" y usa un `userData` distinto (variable `BIT_CHANNEL`), para que una prueba no dañe los datos estables.
3. **Promoción:** PR de `preview` a `main` solo con CI verde y `docs/PROMOTION-CHECKLIST.md` completa (seguridad, privacidad, pruebas manuales, documentación). Versiones SemVer, etiquetas `vX.Y.Z` y `vX.Y.Z-preview.N`.
4. CI en runner de Windows: lint, typecheck, tests, build y `npm audit --omit=dev`; `permissions: contents: read`; acciones fijadas por SHA; sin secretos. Lo que necesita Ollama, audio o GPU no corre en CI.
5. `docs/ARCHITECTURE.md` explica el flujo con un diagrama.
**Aceptación:** repo con la estructura, CI verde, un PR de ejemplo `preview` → `main` documentado.

## FASE 2 — Núcleo seguro (portar y endurecer)
1. Portar: registro de herramientas con riesgo y aprobación, rutas seguras, diffs con hash, lectura de ICS, memoria Markdown, `local-url`, tests.
2. Corregir antes de portar:
   - Rutas de ejecutables (STT, TTS, wake word) solo por diálogo nativo y fuera del esquema de parches de configuración.
   - Aprobaciones de riesgo alto con `dialog.showMessageBox` desde main; el overlay solo aprueba acciones de pantalla.
   - `bit:tool-approve` restringido por tipo y ventana.
   - Kill switch global (Control+Alt+Esc).
   - `coding.runScript` muestra el comando real y pide confirmación extra si cambió `package.json` o `.npmrc`.
   - Eliminar el camino legacy (`bit-file`, `bit-open-app`, `bit-open-url`).
   - CSP por `<meta>` (en `file://` las cabeceras no aplican; verificar con test).
   - Lista blanca de extensiones al abrir; bloqueo de `.exe .bat .cmd .ps1 .vbs .js .jse .wsf .hta .scr .lnk .msi .jar .reg .com .dll` y de macros.
3. `audit.log` local: herramienta, riesgo, ruta relativa, tamaño y hash; nunca contenido.
4. Sin red en todas las ventanas y sesiones (`webRequest.onBeforeRequest` cancela lo que no sea `file:`, `data:`, `devtools:` o loopback), sin spellcheck, y un test de cero salidas fuera de `net-gateway`.
5. Limpieza heredada: `contextSize` 8192 (mínimo 4096), `keep_alive` configurable, métricas locales de latencia, test de rutas independiente del sistema operativo, y el test que hoy falla por rutas de Windows.
**Aceptación:** `verify` verde; tests de cada corrección.

## FASE 3 — Modelos y rendimiento en CPU
1. **Medición primero:** `npm run bench:models` mide por modelo y en este equipo tokens por segundo, tiempo al primer token y RAM, con pedidos en español (charla, números en palabras para voz, herramientas, código corto). Guarda un perfil local.
2. **Enrutador sin LLM** (reglas y palabras clave): charla, voz, saludo y resumen → 3B; código, páginas, documentos, planes de varios pasos y "pensalo mejor" → 7B; pantalla → visión. Respaldo al 3B si el 7B falla o tarda demasiado.
3. **Herramientas con modelos chicos:** el 3B no elige herramientas libremente. El código elige la herramienta y el modelo solo completa los argumentos con salida estructurada (JSON Schema), que se valida; si no valida, se pide una aclaración. Detectar capacidades con `/api/show`, cachearlas y no enviar herramientas a un modelo que no las admite.
4. **Aviso de tiempo:** antes de una tarea pesada, estimar la duración con el perfil medido y avisar ("esto va a tardar unos N minutos, ¿sigo?"); si es excesiva, sugerir una alternativa más liviana. Frase de relleno por plantilla mientras trabaja el 7B.
5. Precalentar el 3B al iniciar; el 7B bajo demanda; si no caben juntos, cargar uno por vez y avisarlo. Historial por tokens con resumen incremental, prefijo de prompt estable, pedidos concurrentes serializados, timeout de inactividad.
**Aceptación:** tabla de latencias y RAM medidas; tests del enrutador, de la migración de configuración y de la validación de argumentos.

## FASE 4 — Voz
Sidecar Python en `voice-sidecar/`, orquestado desde main, local y sin red.
- **Micrófono:** selector de dispositivo, medidor de nivel, botón Probar, atajo push-to-talk. Permiso de micrófono solo para ventanas propias.
- **VAD** Silero con endpointing de 500–700 ms (configurable). **STT** faster-whisper en español, con un modelo chico medido en CPU.
- **Despertar** ("Bit" y "Bit, ¿estás despierto?") más un atajo. Comparar con cifras (CPU en reposo, falsas activaciones, aciertos): (a) detector entrenado tipo openWakeWord (nunca Porcupine), (b) STT liviano sobre ráfagas cortas tras el VAD con coincidencia difusa, (c) solo atajo. Implementar el mejor y dejar documentado por qué.
- **TTS:** Piper persistente (modelo cargado, entrada por línea, salida PCM); voz, velocidad y volumen en ajustes. Verificá el estado y la licencia actuales de Piper antes de depender de él. El usuario coloca Piper y el `.onnx` con su `.json` mediante diálogo nativo.
- Protocolo JSON por líneas sobre stdio (`spawn`, `shell:false`, argumentos fijos), esquemas Zod, reinicio con backoff, manejo de error/EPIPE, backpressure, bloques de ~30 ms.
- **Streaming por oración:** Ollama → segmentador → cola de Piper. **Interrupción:** si hablás mientras Bit habla, se calla, vacía la cola y cancela la generación.
- `scripts/setup-voice.ps1` lo ejecuta el usuario; nada se descarga solo.
**Aceptación:** hablás, transcribe, responde por voz en oraciones y se calla si lo interrumpís, sin internet.

## FASE 5 — Overlay, canción de inicio y saludo
1. **Círculo** arriba a la derecha (esquina configurable), visible **solo sobre otras ventanas**, no sobre la principal de Bit. Al iniciar se abre la aplicación completa. Sin robar foco, clics que atraviesan, colapsado (~120 px) y expandido con transcripción y botón de interrupción; sin fullscreen; animaciones solo con `transform`/`opacity`, pausadas en reposo.
2. **Canción de inicio:** el usuario elige su propio archivo (mp3, wav, ogg, m4a, flac, máx. ~30 MB, validado con rutas seguras), volumen, punto de inicio, duración máxima, fundido de salida, Probar y Desactivar. Bit copia el archivo a su carpeta local y lo reproduce con una URL `blob:`; baja el volumen mientras habla el saludo. No se incluye ni se descarga ninguna canción.
3. **Saludo determinista** (sin LLM) según la hora, con el nombre y el tratamiento configurados (umbrales configurables, nombre máx. 40 caracteres sin caracteres de control).
**Aceptación:** al abrir suena la canción y aparece la ventana; al cambiar de ventana aparece el círculo.

## FASE 6 — Control de la computadora
Pregunta solo lo peligroso o lo que modifica algo (regla 3).
- **Pestañas:** `browser.openTab(url)` solo `http/https` validados (bloquea `file:`, `javascript:`, `data:` y protocolos del sistema). `browser.closeTab()` envía Ctrl+W solo después de verificar que la ventana activa es un navegador (por título y proceso; verificá los tipos reales de la API de ventanas de nut-js), muestra el título en la autorización, nunca cierra si es Bit o si el título sugiere cambios sin guardar, y máximo una pestaña por aprobación. **Prohibido** `--remote-debugging-port`.
- **Archivos y apps:** `files.search` (solo lectura, solo carpetas permitidas, índice SQLite local por nombre y, opcional, por contenido); abrir archivos y carpetas dentro de raíces permitidas; abrir apps de un catálogo que solo edita el usuario; enfocar ventanas; atajos de teclado de lista blanca; scroll; clics guiados por pantalla.
- **Planes de varios pasos** (máximo N): se muestran completos si alguno modifica algo, y son cancelables.
- **Programar:** herramientas `coding.*` dentro de la carpeta de proyecto elegida; siempre diff y aprobación antes de modificar; `runScript` solo para test, build, typecheck y lint.
- Completar `media.control` (hoy es un stub).
**Aceptación:** tests de cada herramienta, incluidos los casos bloqueados; checklist manual de pestañas.

## FASE 7 — Internet y búsqueda
1. `onlineMode` y el indicador visible (orbe y bandeja); kill switch.
2. `net-gateway.ts`: solo HTTPS; bloquea localhost, IPs privadas, link-local y metadatos de nube, también tras redirecciones; sin cookies ni Referer; timeout, tamaño y tipos limitados; `audit.log` de salidas (host, tamaño, hash de la consulta; sin contenido).
3. **Buscar:** el motor lo elegís vos con criterios en este orden: privacidad, no requerir cuenta, esfuerzo de instalación, costo. Compará con la documentación vigente (por ejemplo SearXNG local y APIs con clave), documentá la decisión en `docs/SEARCH.md`, y dejá el proveedor enchufable. Las claves van en `safeStorage`.
4. **Leer y resumir:** si el usuario lo pide, Bit descarga la página elegida (se muestra la URL exacta), extrae el texto sin ejecutar JavaScript, y lo resume con el 7B (o el 3B si es corto). El resumen se entrega **escrito, en voz alta (Piper) o ambos**, según se pida. Respuestas con fuentes.
5. El contenido web es dato no confiable: mientras esté en contexto las herramientas son de solo lectura y no se siguen enlaces automáticamente. Avisar si la consulta saliente incluye correos, teléfonos o claves.
6. **Notion:** integración de **solo lectura**, con token en `safeStorage`, limitada a la base de tareas que elija el usuario, y solo con las propiedades necesarias (título, fecha, estado). Verificá la API vigente.
7. **Google Calendar:** dirección iCal secreta, solo lectura, cifrada con `safeStorage`, nunca en logs, errores ni IPC al renderer.
**Aceptación:** tests con servidor simulado (éxito, bloqueos de red privada, redirecciones, tamaño excedido); test de cero salidas fuera de `net-gateway`.

## FASE 8 — Resumen del día al abrir
1. Al abrir Bit se muestra de inmediato la **última copia guardada** y se actualiza en segundo plano (sin bloquear el arranque), con el indicador de conexión. Sin conexión: se usa la copia y se marca su antigüedad.
2. Contenido por plantilla: fecha → eventos de hoy (Calendar) → tareas vencidas, de hoy y próximas (Notion) → "Te sugiero empezar por…". Un resumen completo por día, y "dame el resumen" a pedido, en voz o escrito.
3. Sin recordatorios ni alarmas automáticas.
**Aceptación:** tests con datos simulados; medición del tiempo hasta mostrar el resumen.

## FASE 9 — Bóveda de Obsidian (la que ya existe)
1. La bóveda viene de una versión vieja de Bit. **Paso 0 (usuario):** hace una copia de seguridad. Bit la abre primero en modo solo lectura y entrega un informe de compatibilidad (estructura, frontmatter, enlaces rotos, formato antiguo).
2. Migración de formato viejo solo con vista previa y respaldo; nunca tocar `.obsidian`; escritura solo bajo una carpeta propia (`Bit/`), con nombres válidos en Windows y escritura atómica.
3. **Pedir autorización explícita antes de guardar** el contexto de la conversación o un resumen de un proyecto en la bóveda.
4. Corregir los fallos conocidos: la raíz por defecto era el repo; backlinks resueltos por nombre de archivo y alias como Obsidian (verificar con test); parseo de frontmatter, aliases, tags y `#etiquetas`; límites configurables con aviso "indexadas X de Y"; exclusiones (`.obsidian`, `.trash`, ocultas, symlinks, conflictos de sincronización, carpetas privadas).
5. Embeddings locales opcionales (`/api/embed`). Tests con una bóveda ficticia; la real nunca entra al repo.
**Aceptación:** informe de compatibilidad sobre la bóveda real (sin copiar su contenido al repo) y tests con fixtures.

## FASE 10 — Pantalla: ver y señalar
1. Captura bajo demanda, con consentimiento inicial, lista de exclusión, imagen solo en memoria y auditoría sin contenido; reducir a ~1280 px de lado largo antes de enviarla.
2. **Texto:** OCR local (Tesseract con español) con cajas por palabra. **Imágenes y diseño:** modelo de visión bajo demanda, descargando el 7B antes y volviéndolo a cargar después. Sin `visionModel`, Bit responde con OCR y avisa la limitación. Medir el tiempo en este equipo y avisarlo al usuario.
3. **Señalar:** ventana transparente que deja pasar clics y dibuja rectángulos, flechas y resaltados; para texto usa las cajas del OCR, para elementos sin texto el modelo de visión con resultado validado. Corregir el mapeo multi-monitor con distinto DPI (`screen.dipToScreenRect`/`screenToDipRect`) con test de pantallas simuladas. El resaltado desaparece solo o con la voz.
4. Respuesta de pantalla en streaming con voz por oración.
**Aceptación:** test de mapeo con displays simulados; checklist manual con capturas reales.

## FASE 11 — Documentos, páginas y programas
El modelo nunca escribe el archivo final: entrega una **especificación JSON validada con Zod** y Bit la renderiza con código determinista, sin red. Con un 7B se hace en pasos cortos: plan → relleno por secciones → validar y reparar (máx. 2 reintentos).
**Orden de implementación:** HTML → PDF → Word → Excel → PowerPoint. Cada formato se cierra y prueba antes del siguiente.
1. **Entrega:** carpeta de salida elegida con diálogo nativo; cada pedido crea `AAAA-MM-DD_nombre/`; escritura atómica, sufijo (2) ante colisiones, versiones v1, v2… y un `.bit.json` de apoyo.
2. **HTML:** `index.html` autocontenido, responsive, claro y oscuro, con CSP restrictiva (`default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline'; img-src data:; font-src data:; connect-src 'none'; form-action 'none'`) y un validador que rechaza URLs externas, iframes, `fetch`/`XMLHttpRequest`/`WebSocket`/`sendBeacon`, `eval` y `new Function`. Vista previa en una ventana aislada sin red.
3. **PDF:** HTML + CSS de impresión con `webContents.printToPDF` en ventana aislada, sin dependencias nuevas.
4. **Word, Excel, PowerPoint:** librerías solo bajo la política de dependencias (plan B con `jszip`); layouts fijos 16:9 con notas para PowerPoint; fórmulas de lista blanca (`SUM AVERAGE MIN MAX COUNT IF ROUND`) con escape de `= + - @`; nunca formatos con macros.
5. **Programas:** carpeta con README, `.gitignore`, pruebas y `.zip` opcional. Bit no los ejecuta.
6. **Validar antes de decir "listo":** zip válido y reabierto (docx/xlsx/pptx), PDF con las páginas esperadas, HTML que pasa el validador. Cálculos y fechas los hace el código, no el modelo.
7. **Edición por conversación:** parche estructurado sobre la especificación → nueva versión con diff y deshacer; los archivos ajenos se modifican siempre sobre una copia.
8. Regla del prompt de sistema: ante un pedido de documento, página, planilla, presentación o programa, crear el archivo con la herramienta y entregar su ubicación; no pegar el contenido en el chat salvo que lo pidan; no decir "listo" hasta que se escribió y validó. Una sola pregunta corta si falta algo esencial.
**Aceptación:** por cada formato, un archivo de ejemplo generado, validado y listado para abrir a mano en el programa real (prueba manual).

## FASE 12 — Configuración, modelos, empaquetado y cierre
1. **Primer arranque guiado:** nombre y tratamiento, carpeta de entregas, bóveda, micrófono, Piper, canción de inicio, Notion y Calendar, y la medición inicial de modelos.
2. **Menú único de configuración**, sin editar JSON, con buscador, ayuda en cada opción y validación en vivo: General · Modelos · Voz · Canción de inicio · Pantalla · Privacidad (interruptor de internet, indicador, registro de salidas, guía de firewall) · Permisos (herramientas por riesgo, apps y carpetas permitidas, kill switch) · Archivos y proyectos · Calendario y tareas · Avanzado (exportar e importar sin secretos, restablecer por sección, registros y métricas). Presets: Rápido, Equilibrado, Privacidad máxima. Indicar cuándo un cambio requiere reiniciar; accesible con teclado y lector de pantalla.
3. **Actualización de modelos con permiso:** desactivada por defecto; botón Buscar actualizaciones. La descarga la hace Ollama por su API local (`/api/pull`); antes se verifica el espacio en disco y se hace una copia (`/api/copy`) para volver atrás; después, una prueba de humo local y, si falla, restauración automática. Nunca se cambia de modelo solo: las familias o versiones nuevas se ofrecen desde `models-catalog.json` y el usuario elige. Las actualizaciones de la app y de Ollama se anuncian pero no se instalan sin confirmación.
4. **Empaquetado:** electron-builder, Electron Fuses (RunAsNode, NODE_OPTIONS e inspector deshabilitados), inicio con Windows opcional y lanzador sin terminal; canales "Bit" y "Bit Preview".
5. **Cierre:** `verify` y `npm audit --omit=dev` limpios o con excepciones documentadas; test de cero tráfico no local; evaluación local con ~20 pedidos en español; checklist manual de privacidad (firewall, `netstat`) y de apertura de formatos; documentación completa; reporte final de lo no verificado.

---

## Definición de terminado
Abro Bit y suena mi canción; se abre la ventana principal y me saluda por mi nombre con un resumen del día de mis tareas de Notion y mi calendario. Al cambiar a otra ventana aparece el círculo arriba a la derecha. Digo "Bit, ¿estás despierto?", hablo, responde con voz por oraciones y se calla si lo interrumpo. El 3B contesta lo liviano y el 7B lo pesado, avisándome cuando algo va a tardar. Le pido una página, un Word, un Excel, un PowerPoint o un PDF y recibo el archivo validado. Ve mi pantalla y me señala lo que le pregunto. Abre y cierra pestañas, busca archivos, y me pide autorización solo cuando algo es peligroso o modifica algo. Busco en internet, lee la página y me la resume en voz o por escrito. Se conecta a mi bóveda de Obsidian sin dañarla y me pide permiso antes de guardar nada. Todo se configura desde un menú fácil, y todo el código nuevo vive en `preview` hasta que lo paso a `main`.
