# Privacidad de las actualizaciones de modelos

Las actualizaciones están desactivadas por defecto. Bit carga modelos GGUF directamente mediante `node-llama-cpp`; no usa Ollama ni una API de chat HTTP. Bit no cambia ni descarga modelos por su cuenta.

Para descargar un modelo del catálogo fijo, el usuario pulsa el botón correspondiente y aprueba el diálogo nativo. Bit reanuda el archivo parcial cuando es posible, muestra progreso y verifica el SHA256 antes de aceptar el GGUF. Si la verificación falla, elimina el parcial.

## Búsquedas web

Bit no busca en internet al iniciar ni en segundo plano. Solo hace una búsqueda cuando el usuario la pide explícitamente o pregunta por información que cambia con el tiempo, como el clima o las noticias. La búsqueda envía a Bing únicamente el texto de consulta necesario; no envía el historial de conversación, notas de Obsidian, archivos ni capturas. No abre automáticamente las páginas encontradas.

Las búsquedas se realizan desde `net-gateway` por HTTPS, con un límite de tiempo y tamaño de respuesta. Los resultados solo se muestran si el enlace usa HTTPS y su dominio coincide con dominios gubernamentales, organismos internacionales y universidades, o con una lista explícita de fuentes oficiales; se rechazan enlaces inseguros, dominios parecidos y redirecciones. Si no queda una fuente aceptada, Bit lo indica en vez de presentar resultados dudosos. Esta comprobación de dominio reduce el riesgo, pero no sustituye la verificación humana del contenido. Para consultas del clima, el gateway consulta Open-Meteo para geocodificar la ciudad y obtener condiciones actuales y el pronóstico del día; no consulta Bing para esas preguntas. Solo envía la ciudad indicada (o Buenos Aires si no se especifica ubicación), nunca el historial, notas de Obsidian, archivos ni capturas. Bit conserva en memoria únicamente la última pregunta sobre el clima para entender seguimientos como «¿y en Brasil?»; se borra al recibir una pregunta que no sea de seguimiento y no se persiste al cerrar la aplicación. «Brasil» se consulta como Brasília, Brasil, para dar un punto local concreto. Los resultados se tratan como contenido externo no confiable y se muestran sus fuentes. La interfaz principal y el overlay indican cuándo hay actividad de red. Bit registra localmente en `userData/audit.log` el host, la consulta y el resultado de cada búsqueda; el registro no se envía a ningún servicio.

Las descargas de voz/modelos también pasan por `net-gateway`, usan hosts permitidos y requieren consentimiento antes de comenzar.

El nombre preferido se guarda localmente en `userData/config.json`. Bit lo usa en el saludo de inicio y para dirigirse al usuario ocasionalmente; puede borrarse desde Ajustes.
El contexto reciente de la conversación se mantiene solo en memoria mientras la ventana está abierta y se entrega únicamente al modelo GGUF local. No se guarda en disco ni se incluye en búsquedas web.

## Proyectos locales

El usuario elige la carpeta de proyectos en Ajustes. Bit rechaza rutas UNC, enlaces simbólicos en la carpeta elegida y ubicaciones dentro de un repositorio Git. Los proyectos y sus respaldos permanecen en esa carpeta; Bit no los sube ni sincroniza. Las herramientas de proyecto solo admiten texto UTF-8 de hasta 1 MiB por archivo, limitan cada listado a 500 archivos y bloquean rutas que salgan del proyecto. Bit nunca ejecuta los archivos que crea.

Crear, modificar o restaurar requiere confirmación nativa desde el proceso principal. Antes de reemplazar un archivo, Bit conserva su contenido anterior bajo `.bit-backups/`; al restaurar también conserva la versión actual. Las copias no tienen caducidad automática, pueden crecer con el uso y no tienen cifrado propio de Bit. La privacidad en reposo depende de la cuenta de Windows, del cifrado del disco y de la carpeta elegida. No elija OneDrive, Dropbox, unidades de red ni otras carpetas sincronizadas para proyectos confidenciales. Las lecturas y escrituras se registran en `userData/audit.log` sin registrar el contenido de los archivos.

Si el usuario pide analizar un archivo, su texto se entrega al modelo GGUF local. No se adjunta a búsquedas web ni a servicios remotos. Las solicitudes con captura de pantalla no ofrecen herramientas de escritura de proyectos en ese turno.

Antes de publicar, comprobar manualmente en la interfaz de Windows: elegir una carpeta local no sincronizada; crear un proyecto y archivo de prueba; cancelar y luego aprobar una modificación; verificar que la copia anterior aparece en `.bit-backups/`; restaurarla y comprobar que la versión reemplazada también quedó respaldada. Confirmar que la carpeta de proyectos dentro de un repositorio Git se rechaza y que `audit.log` no contiene el texto de prueba.

## Control local del equipo

Las herramientas de control se ejecutan en el proceso local de Bit. Abrir una aplicación conocida o un documento permitido no requiere autorización adicional; las acciones sensibles (por ejemplo, abrir protocolos del sistema, lanzar ejecutables con argumentos o abrir archivos activos como scripts) muestran un diálogo nativo cuya opción predeterminada es cancelar. Las descargas siempre requieren confirmación explícita y verifican el hash. Bit bloquea la apertura directa de direcciones públicas desde el ejecutor local para evitar tráfico fuera del gateway.

Al cerrar la ventana principal, también se cierra el HUD y termina la aplicación. Bit libera directamente las sesiones, contextos y modelos GGUF residentes antes de salir; los archivos del modelo no se modifican.
