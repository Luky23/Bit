# Sidecar Piper

El sidecar corre localmente con `shell: false`, argumentos explícitos y JSONL por stdin/stdout. No descarga voces, modelos STT ni inicia servidores. Piper es opcional para poder dictar aunque no esté configurada la voz de salida.

Para dictar:

1. Instale las dependencias de voz manualmente según la política del repositorio.
2. Obtenga y coloque previamente un modelo faster-whisper convertido para CTranslate2 fuera del repositorio. La carpeta debe incluir `model.bin` y `config.json`.
3. En Ajustes, elija esa carpeta con **Elegir carpeta del modelo**.
4. Mantenga pulsado **MIC** mientras habla y suéltelo para transcribir. Bit deja el texto en el campo de chat para que lo revise antes de enviarlo.

La aplicación nunca descarga el modelo de transcripción. La selección de carpeta solo guarda su ruta en la configuración local de Bit.

Prueba manual:

```text
main/voice-sidecar/.venv/Scripts/python.exe main/voice-sidecar/sidecar.py --model C:\ruta\voz.onnx --config C:\ruta\voz.onnx.json --whisper-model C:\ruta\modelo-ctranslate2
```

Para probar solo dictado, se pueden omitir `--model` y `--config`. No ejecutar esa prueba desde Bit como comando libre: la aplicación debe validar la ruta y pedir aprobación según las reglas permanentes.
