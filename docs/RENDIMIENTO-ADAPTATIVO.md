# Rendimiento adaptativo

Bit mantiene el perfil en el proceso principal mediante `AdaptivePerformanceManager`. No clasifica el equipo por el nombre del procesador ni consulta servicios externos.

## Datos recopilados

- CPU y núcleos: `node:os`; la utilización se estima comparando los contadores de tiempo entre muestras.
- RAM total y disponible: `node:os`, actualizada al menos cada cinco segundos mientras se consulta el perfil.
- GPU: `app.getGPUInfo("basic")`, estado de funciones de Electron y disponibilidad de aceleración. Si Electron no puede consultarla, se informa como no disponible; no se infieren VRAM ni capacidades ausentes.
- Sistema operativo: plataforma y versión de `node:os`.
- Almacenamiento: bloques disponibles y totales en el volumen de `appData`, mediante `statfs`.
- Monitores: dimensiones y escala informadas por Electron.

El historial agregado se guarda en `userData/performance-history.json`, con reemplazo atómico. Solo contiene tipo de tarea, duración, espera en cola, complejidad numérica, resultado, marca de timeout y variación aproximada de RSS. No conserva prompts, rutas, nombres de archivos, documentos ni respuestas.

## Presupuestos y planificador

Los presupuestos son independientes por clase de operación. Se calculan con una base por tarea, la raíz cuadrada de la complejidad, núcleos disponibles, carga CPU observada, RAM libre y modo seleccionado. Tras cinco ejecuciones comparables completadas, el percentil 80 influye gradualmente en una fracción del presupuesto; una sola ejecución no lo cambia de forma abrupta. Cada clase conserva un límite máximo finito.

La generación de modelos tiene límite total, presupuesto de conexión local, espera máxima al primer token/progreso e inactividad entre tokens. La actividad solo reinicia el límite de inactividad; nunca extiende el máximo total. La API de Ollama no expone una señal verificable para separar su carga interna del instante del primer token, por lo que ambos comparten el presupuesto de primera salida. Las consultas JSON locales usan además un límite total de operación.

Las tareas esperan en una cola con prioridad interactiva, conversación, Workspace, archivos y mantenimiento. La concurrencia automática se limita según núcleos y RAM, y se reduce con CPU/RAM bajo presión. El ajuste manual es un techo, no una obligación de ocupar todos los espacios. El modo ahorro permite una tarea; equilibrado limita a dos; máximo rendimiento sigue respetando los recursos medidos.

La cancelación se propaga mediante `AbortSignal` al cliente de modelo. Si una operación ignora la señal, permanece visible como `cancelling` y conserva su plaza hasta resolverse; así el timeout no finge haber liberado recursos ni permite que se acumulen tareas ocultas. Una navegación de resultado incierto no se reintenta automáticamente para evitar duplicar aperturas.

## Visor holográfico

La calidad manual cambia la resolución interna del canvas y los efectos; el modo automático la reduce ante carga CPU/RAM alta o mallas de gran tamaño. La geometría no se altera. El perfil se comunica a la vista integrada del Workspace.

## Validación y límites actuales

Las pruebas unitarias simulan perfiles CPU/RAM, almacenamiento, GPU no consultable, streaming, operación bloqueada, cancelación, límite total y prioridades. La consulta GPU tiene un máximo independiente de cinco segundos y puede quedar como no disponible; no bloquea indefinidamente el inicio del perfil. Las pruebas no sustituyen la comprobación física en equipos distintos.

Por ahora el planificador se aplica a generación local, consultas de disponibilidad de Ollama y la apertura musical de navegador. Las búsquedas/lecturas/escrituras generales de archivos, OCR, automatización de Windows, navegación web externa y la vista de proyecto secundaria conservan sus propios mecanismos; sus esperas no se migraron en bloque. Las consultas de GPU, espacio de disco y monitores dependen de lo que exponga Electron/Windows y pueden quedar como no disponibles.
