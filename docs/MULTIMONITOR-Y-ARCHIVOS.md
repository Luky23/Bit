# Distribución de pantallas y recepción de archivos

En Ajustes → Disposición Multimonitor se elige una vista por monitor:

- Principal: núcleo, conversación y tarjetas contextuales a la derecha.
- Proyecto: selección de proyecto, archivos y lectura de contenido local.
- Información: operaciones en curso e historial de cambios de la sesión.
- Ocultar: no abre un panel en esa pantalla.

Con tres pantallas, la distribución automática es proyecto a la izquierda,
principal en el centro e información a la derecha. Con dos, principal y proyecto.
Al asignar un rol ocupado se intercambian las vistas. Siempre queda una principal
accesible, incluso al desconectar su monitor. Se utiliza el área útil de Windows
y las preferencias se guardan localmente.

Los paneles son de solo lectura, usan un puente IPC limitado y se actualizan por
eventos, sin consultar un modelo adicional ni mantener sondeos periódicos.
El historial incluye las últimas 40 operaciones realizadas mediante herramientas
de proyectos de Bit durante esta sesión; no constituye un historial Git ni detecta
ediciones realizadas desde otras aplicaciones. Las vistas antes/después se limitan
a 8.000 caracteres por versión. El explorador hereda el límite de 500 entradas del
espacio de proyectos. No se añadieron dependencias.

Los archivos pueden soltarse sobre la ventana principal o el núcleo flotante.
Este último abre las acciones en la principal. Un fallo conserva el archivo para
reintentar. Los textos de las vistas se guardan en UTF-8.

## Verificación automatizada

Las pruebas de distribución ejercitan el gestor con pantallas y ventanas simuladas:
uno, dos y tres monitores, intercambio de roles, persistencia, recuperación tras
desconexión y respeto del área útil. Las pruebas de interacción ejecutan los
listeners de arrastre y soltado con un DOM simulado y comprueban el reintento.
También se comprueba la ausencia de texto recodificado en las cuatro vistas.

Los diez casos específicos pasan. `npm run typecheck` pasa. La suite completa
no está aprobada: presenta fallos en contratos de chat, voz, arranque, apariencia
y puentes IPC. No se declara cerrada la fase ni se atribuyen esos fallos a una
línea base sin haberla ejecutado sobre el estado inicial exacto.

Resultado completo: **284 pruebas, 262 aprobadas, 21 fallidas y una omitida**.
Fallos registrados, agrupados por archivo:

- [agent.test.mjs](../main/tests/agent.test.mjs): generación breve y prompt liviano.
- [chat-scroll.test.mjs](../main/tests/chat-scroll.test.mjs): área del chat principal, desplazamiento del overlay y núcleo estático (3).
- [main-window.test.mjs](../main/tests/main-window.test.mjs): estructura principal, ajustes agrupados y errores en telemetría (3).
- [overlay.test.mjs](../main/tests/overlay.test.mjs): núcleo compartido y reacción al RMS.
- [preload.test.mjs](../main/tests/preload.test.mjs): cantidad de puentes, canción inicial, precarga de Piper, cierre de Llama, canales con handlers y eventos con emisores (6).
- [release.test.mjs](../main/tests/release.test.mjs): tokens visuales compartidos.
- [screen-analysis.test.mjs](../main/tests/screen-analysis.test.mjs): fallback de OCR.
- [voice-autoreply.test.mjs](../main/tests/voice-autoreply.test.mjs): activación de Piper, audio en ambos núcleos y dictado editable (3).
- [voice.test.mjs](../main/tests/voice.test.mjs): sidecar empaquetado y voz ONNX sin JSON lateral (2).

## Checklist manual pendiente

- Soltar un TXT desde el Explorador sobre la ventana principal y sobre el núcleo.
- Confirmar que aparece el nombre, que Cancelar no procesa y que un error permite reintentar.
- Comprobar visualmente tildes, signos y botones; probar PDF e imagen con los servicios locales disponibles.
- Conectar dos y tres monitores físicos, incluyendo escalas y resoluciones distintas.
- Cambiar las vistas desde Ajustes, reiniciar y comprobar la restauración.
- Desconectar el monitor de la principal y comprobar que se recupera en una pantalla conectada.
- Comprobar archivos, operaciones en curso y vistas antes/después de una modificación autorizada.
- Medir CPU, RAM y latencia con el equipo real y las ventanas abiertas; no se hicieron afirmaciones de rendimiento medido.

La interacción con el Explorador, la disposición visual y el hardware multimonitor
no se probaron en una sesión nativa de Windows durante esta intervención.
