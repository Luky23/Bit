# Privacidad de las actualizaciones de modelos

Las actualizaciones están desactivadas por defecto. Bit solo llama a la API local de Ollama en `127.0.0.1`; si Ollama descarga datos desde su registro, esa conexión pertenece a Ollama y no a Bit. Bit no cambia de modelo por su cuenta.

Para actualizar, el usuario debe activar la función, seleccionar los tags y aprobar cada operación. Bit comprueba espacio, crea una copia con fecha, muestra el progreso y ejecuta una prueba de humo. Si falla, restaura la copia automáticamente. Los modelos recomendados nuevos solo se anuncian mediante `models-catalog.json`, revisado por cambios del repositorio.
