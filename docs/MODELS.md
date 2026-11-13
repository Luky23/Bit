# Modelos GGUF y roles

Bit usa `node-llama-cpp` directamente, sin Ollama ni un servidor HTTP local.

- `fastModel`: conversación, voz, saludos y resúmenes.
- `heavyModel`: programación, documentos y tareas extensas.
- `visionModel`: análisis visual bajo pedido.
- `visionProjection`: proyección multimodal local cuando el adaptador la soporte.

Al iniciar, Bit escanea automáticamente `userData/models`, la carpeta `models` de la aplicación y las ubicaciones habituales de LM Studio, Hugging Face, GPT4All y Jan. Solo muestra los archivos GGUF locales que encuentra; no solicita ni guarda carpetas elegidas por la persona usuaria. El recorrido es recursivo, acotado y omite enlaces externos y carpetas pesadas. Lee la cabecera GGUF con memoria acotada para mostrar tamaño, arquitectura, cuantización inferida del nombre y contexto declarado.

Solo se mantiene un modelo residente. Al cambiar de rol se liberan el contexto y los pesos anteriores para cuidar los 16 GB de RAM del equipo objetivo.

## Descargas opcionales

Configuración ofrece Qwen2.5 3B Instruct Q4_K_M y Qwen2.5 Coder 7B Instruct Q4_K_M. La descarga:

1. requiere confirmación nativa;
2. usa únicamente una URL HTTPS fijada de Hugging Face mediante `net-gateway`;
3. continúa un archivo `.part` cuando el servidor admite rangos;
4. calcula SHA256 con streams;
5. elimina el parcial si el hash no coincide.

Los modelos nunca se incluyen en el ejecutable ni se descargan al iniciar Bit.

## Verificación manual pendiente

Después de instalar manualmente las dependencias nativas, medir en la Galaxy Book3: tiempo de primera carga, tokens por segundo, RAM máxima y tiempo de liberación al alternar roles. Registrar las cifras antes de cambiar contexto, cuantización o número de hilos.
