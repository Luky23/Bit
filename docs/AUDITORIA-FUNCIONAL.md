# Auditoría funcional de Bit

Fecha: 2026-11-06  
Rama: `preview`

## Resultado verificable

- `npm run typecheck`: 29 módulos ESM importados correctamente.
- `npm test`: 162 pruebas aprobadas, 0 fallos.
- La apertura de cualquier aplicación, archivo, protocolo o pestaña requiere confirmación nativa.
- El manifiesto principal ya no contiene una clave `devDependencies` duplicada.

Las pruebas automáticas no sustituyen las comprobaciones manuales de micrófono, altavoces, cámara, pantalla, Ollama ni apertura de documentos en aplicaciones reales de Windows.

## Estado por función

| Función solicitada | Estado | Evidencia y límite actual |
|---|---|---|
| Conversación escrita | Implementada | Enrutamiento local entre Qwen 2.5 3B y Qwen 2.5 Coder 7B, contexto acotado y respuestas en español. Falta medir latencia y RAM con Ollama real en el equipo objetivo. |
| Voz de entrada | Implementada, pendiente de prueba manual | Dictado local mediante `faster-whisper`, pulsar-para-hablar y transcripción editable. La instalación nueva permanece bloqueada hasta fijar hashes de Python. |
| Voz de salida | Implementada, pendiente de prueba manual | Piper local, respuesta por oraciones e interrupción. Requiere modelo local elegido por el usuario. |
| Activación por nombre | No implementada | Existe una opción de configuración, pero no un detector conectado y medido. Debe compararse STT por ráfagas, detector local y atajo con CPU, RAM, aciertos y falsos positivos. |
| Activación por aplauso | No implementada | Solo está en la hoja de ruta. No debe quedar escuchando permanentemente hasta medir consumo y falsos positivos. |
| Sonido de inicio | Implementado con archivo local | Se elige, copia y reproduce un fragmento local con volumen y atenuación. La propuesta de sonido predeterminado es una campanilla breve de dos tonos, generada localmente y sin archivo descargado; todavía no está implementada. |
| Interfaz visual | Implementada | Ventana principal Electron y HUD superpuesto, ajustes locales, chat y núcleo visual. Pendiente de prueba manual de accesibilidad y DPI real. |
| Abrir aplicaciones | Implementada con lista blanca | No admite shell libre. Toda apertura o ejecución solicita confirmación nativa y queda limitada a objetivos validados. |
| Ejecutar comandos | Restringida por diseño | No habrá PowerShell o `cmd` libre. Las acciones se exponen como herramientas declaradas, validadas y auditadas. |
| Gestionar proyectos y archivos | Implementada parcialmente | Crea proyectos y archivos de texto, lee, modifica, respalda y restaura dentro de una raíz elegida. Falta búsqueda general segura de archivos y entrega de binarios. |
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
2. Los hashes del catálogo Piper en `main/src/core/downloader.mjs` son marcadores de posición. No se deben descargar modelos con esos valores.
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

