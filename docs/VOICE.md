# Voz local

El canal de voz usa un protocolo JSONL sobre stdio y no abre sockets. El ejecutable Piper, el modelo `.onnx` y el STT se seleccionan mediante diálogo nativo; no se descargan automáticamente. El procesamiento real de micrófono, VAD, faster-whisper, Piper y wake word requiere una prueba manual en Windows con hardware de audio.

La cola divide respuestas por oración, permite vaciar la cola al detectar interrupción y mantiene el endpointing VAD entre 500 y 700 ms. `Porcupine` no forma parte del diseño; el wake word recomendado es “Oye Bit”.
