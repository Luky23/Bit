# Sidecar Piper

El sidecar corre localmente con `shell: false`, argumentos explícitos y JSONL por stdin/stdout. No descarga voces ni inicia servidores. El usuario debe seleccionar mediante diálogo nativo un modelo `.onnx` de Piper y su `.json`; ambos quedan fuera del repositorio.

Prueba manual:

```text
main/voice-sidecar/.venv/Scripts/python.exe main/voice-sidecar/sidecar.py --model C:\ruta\voz.onnx --config C:\ruta\voz.onnx.json
```

No ejecutar esa prueba desde Bit como comando libre: la aplicación debe validar la ruta y pedir aprobación según las reglas permanentes.
