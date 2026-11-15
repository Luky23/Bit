# Distribución de pantallas y recepción de archivos

En Ajustes → Disposición Multimonitor se elige una vista por monitor. Sin
proyecto, la interfaz principal conserva su presentación original. En una
pantalla, abrir, crear o reanudar un proyecto desde el chat activa el Workspace
automáticamente: el explorador aparece a la izquierda y la información a la
derecha sin mover el núcleo central ni ocultar la conversación o la voz. Los
documentos de texto seleccionados se abren en el área central; el núcleo se
reduce temporalmente. Un modelo compatible sustituye ese visor por el visor 3D,
y al cerrarlo se vuelve al proyecto. El pequeño control de inicio devuelve la
interfaz original sin cerrar ni borrar el proyecto. Se respeta el movimiento
reducido.

La navegación admite instrucciones por texto y por voz continua: «abrí el
proyecto FlipDock», «quiero empezar un proyecto nuevo llamado Orbit», «quiero
seguir trabajando» (Bit consulta la sesión guardada y pregunta cómo continuar),
«sigamos con lo que estaba haciendo ayer», «abrí el archivo docs/guía.md» y
«volvé al inicio». La creación conserva la autorización existente y no anuncia
éxito si falla. La apertura de un archivo se limita al proyecto activo o a la
última sesión guardada; un nombre de archivo ambiguo requiere indicar la ruta.
El dictado pulsar-para-hablar sigue requiriendo revisar y enviar la transcripción.

- Principal: núcleo, conversación y tarjetas contextuales a la derecha.
- Proyecto: selección de proyecto, archivos y lectura de contenido local.
- Información: operaciones en curso e historial de cambios de la sesión.
- Ocultar: no abre un panel en esa pantalla.

Con dos pantallas, la principal mantiene Bit y un resumen discreto del proyecto,
mientras el Workspace ocupa la secundaria. Con tres, el primario conserva Bit y
las restantes reciben Workspace y Project Intelligence, en orden físico de
izquierda a derecha. Las asignaciones pueden ajustarse manualmente en
Disposición Multimonitor.
Al asignar un rol ocupado se intercambian las vistas. Siempre queda una principal
accesible, incluso al desconectar su monitor. Se utiliza el área útil de Windows
y las preferencias se guardan localmente.

Los paneles usan un puente IPC limitado y se actualizan por eventos, sin mantener
sondeos periódicos. El explorador de Workspace también importa modelos locales
STL, OBJ, GLB y glTF 2.0. El visor usa Canvas 2D con proyección en perspectiva
para funcionar con la configuración actual de Bit, que desactiva la GPU; no
requiere Three.js, CDN ni nuevas dependencias. Arrastrar rota el modelo, la rueda
Hace zoom con la rueda y desplaza con Mayús+arrastre. Hay vistas frontal,
posterior, superior, inferior, laterales izquierda y derecha e isométrica,
selección y visibilidad de componentes, modos sólido,
wireframe y holograma, y separación/reensamblado de piezas independientes.
En una pantalla, los paneles del proyecto rodean la conversación y el visor 3D
ocupa el área central; en varias pantallas se conserva el panel de proyecto
existente. Dimensiones, triángulos y piezas
visibles se calculan sobre el modelo cargado; no se muestran estimaciones
ficticias. El deslizador de rotación controla el eje horizontal. El dock inferior
usa el chat local de Bit, transmite la respuesta y deja que las herramientas
declaradas del agente actúen sobre el visor. La sección de malla está deshabilitada
porque todavía no hay una operación de corte implementada.

La lectura se limita a archivos dentro del proyecto seleccionado: máximo 64 MiB
con buffers glTF incluidos y 200.000 triángulos. glTF admite buffers locales o
embebidos; no descarga URI de red. Aún no están soportados Draco, accessors
sparse, morph targets ni texturas PBR. STL se trata como una sola malla; si no
hay piezas independientes no se inventa una explosión. Los comandos del agente
para cargar, orientar, rotar, seleccionar, ocultar/mostrar, cambiar modo y
explotar/reensamblar envían acciones al Workspace y esperan confirmación del
visor, no generan solo texto.

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
Las pruebas verifican que el modo de una pantalla usa la ventana principal, que
los paneles contextuales se integran sin quitar conversación/voz y que el visor
central distingue documento de modelo 3D. La interfaz física, las animaciones y
el comportamiento con movimiento reducido siguen requiriendo comprobación visual
en Windows.

Se añadieron pruebas de geometría STL ASCII/binaria, OBJ por grupos, GLB y glTF
con buffers locales, rechazo de rutas inseguras y controles/limpieza del
renderizador. En la verificación final de esta sesión, las 20 pruebas enfocadas
en distribución, Workspace, puentes y proyectos pasan. `npm.cmd run verify`
completa el typecheck (51 módulos) y ejecuta 431 pruebas: 406 aprobadas,
24 fallidas y una omitida; por eso la verificación completa no se considera
aprobada. Los fallos pendientes y la comparación histórica con la línea base
están documentados en
[AUDITORIA-FUNCIONAL.md](./AUDITORIA-FUNCIONAL.md). La prueba de análisis de
pantalla no pudo conectar con Ollama en `127.0.0.1:11434`.

## Checklist manual pendiente

- Sin proyecto, confirmar que Bit conserva su interfaz habitual y no muestra
  paneles de proyecto.
- Con una pantalla, abrir un proyecto por texto y por voz continua: verificar
  que la transición activa los paneles, conserva el núcleo centrado y mantiene
  chat/voz; volver al inicio y confirmar que el proyecto no se borra.
- Probar creación autorizada y fallida, sugerencia de continuación, reanudación
  y apertura de archivos con y sin ruta ambigua.
- Abrir un documento de texto, volver al proyecto y abrir STL/OBJ/GLB/glTF;
  cerrar cada visor y comprobar que el contexto no se pierde.
- Repetir con movimiento reducido activado en Windows y verificar la transición.
- Conectar dos y tres monitores: confirmar que las ventanas siguen abiertas en
  paralelo y que el modo adaptativo de una sola pantalla no se activa.
- Soltar un TXT desde el Explorador sobre la ventana principal y sobre el núcleo.
- Confirmar que aparece el nombre, que Cancelar no procesa y que un error permite reintentar.
- El archivo soltado todavía presenta el selector de acciones; su apertura
  automática como contexto de Workspace está pendiente.
- Comprobar visualmente tildes, signos y botones; probar PDF e imagen con los servicios locales disponibles.
- Conectar dos y tres monitores físicos, incluyendo escalas y resoluciones distintas.
- Cambiar las vistas desde Ajustes, reiniciar y comprobar la restauración.
- Desconectar el monitor de la principal y comprobar que se recupera en una pantalla conectada.
- Comprobar archivos, operaciones en curso y vistas antes/después de una modificación autorizada.
- Abrir un STL/OBJ/GLB/glTF real desde el explorador del Workspace; probar rotación, zoom, modos y selección.
- Verificar glTF con buffers relativos y documentar visualmente las limitaciones de piezas o materiales.
- Probar comandos de voz y texto del agente contra el panel abierto; medir CPU y memoria con modelos de hasta el límite.
- Medir CPU, RAM y latencia con el equipo real y las ventanas abiertas; no se hicieron afirmaciones de rendimiento medido.

La interacción con el Explorador, la disposición visual y el hardware multimonitor
no se probaron en una sesión nativa de Windows durante esta intervención.
