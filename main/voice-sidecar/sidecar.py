"""Sidecar Piper local: JSONL por stdin/stdout, sin sockets ni shell.

Protocolo:
  Entrada (stdin):  {"type": "speak", "text": "..."} | {"type": "stop"} | {"type": "vad-calibrate"} | {"type": "stt-start"} | {"type": "stt-stop"}
  Salida (stdout):  {"type": "ready"} | {"type": "audio", "pcmBase64": "...", "sampleRate": 22050, "sampleWidth": 2, "channels": 1} | {"type": "transcript", "text": "..."} | {"type": "level", "rms": 0.0} | {"type": "error", "error": "..."}
"""

from __future__ import annotations

import argparse
import base64
import json
import sys
import threading
import time
from pathlib import Path

# Importaciones perezosas para que el sidecar inicie rápido aunque falten deps opcionales
_PIPER_AVAILABLE = False
_VAD_AVAILABLE = False
_STT_AVAILABLE = False

try:
    from piper import PiperVoice
    _PIPER_AVAILABLE = True
except ImportError:
    pass

try:
    import onnxruntime
    import numpy as np
    _VAD_AVAILABLE = True
except ImportError:
    pass

try:
    from faster_whisper import WhisperModel
    _STT_AVAILABLE = True
except ImportError:
    pass


def send(message: dict[str, object]) -> None:
    sys.stdout.write(json.dumps(message, ensure_ascii=False) + "\n")
    sys.stdout.flush()


def send_error(error: str) -> None:
    send({"type": "error", "error": error})


class PiperTTS:
    """Wrapper de Piper TTS para síntesis por oraciones."""

    def __init__(self, model_path: Path, config_path: Path | None = None):
        if not _PIPER_AVAILABLE:
            raise RuntimeError("piper-tts no instalado. Ejecutá scripts/setup-voice.ps1")
        self.voice = PiperVoice.load(str(model_path), config_path=str(config_path) if config_path else None)

    def synthesize(self, text: str):
        """Genera chunks de audio PCM (int16) para un texto."""
        for chunk in self.voice.synthesize(text):
            yield {
                "type": "audio",
                "sampleRate": chunk.sample_rate,
                "sampleWidth": chunk.sample_width,
                "channels": chunk.sample_channels,
                "pcmBase64": base64.b64encode(chunk.audio_int16_bytes).decode("ascii"),
            }


class SileroVAD:
    """Voice Activity Detection usando Silero VAD (ONNX)."""

    def __init__(self):
        if not _VAD_AVAILABLE:
            raise RuntimeError("onnxruntime/numpy no disponibles para VAD")
        # Silero VAD modelo oficial: https://github.com/snakers4/silero-vad
        # Se espera que el usuario descargue silero_vad.onnx y lo coloque junto al modelo Piper
        self.session = None
        self.sample_rate = 16000
        self.chunk_size = 512  # 32ms a 16kHz
        self._load_model()

    def _load_model(self):
        # Buscar modelo VAD en la misma carpeta que Piper
        import os
        vad_model = Path(os.environ.get("BIT_VAD_MODEL", ""))
        if not vad_model or not vad_model.is_file():
            # Intentar ruta por defecto
            voice_dir = Path(os.environ.get("BIT_VOICE_DIR", ""))
            if voice_dir:
                vad_model = voice_dir / "silero_vad.onnx"
        if vad_model and vad_model.is_file():
            self.session = onnxruntime.InferenceSession(str(vad_model), providers=["CPUExecutionProvider"])
        else:
            raise RuntimeError("Modelo Silero VAD no encontrado. Colocá silero_vad.onnx en la carpeta de voces.")

    def process_chunk(self, pcm_int16: bytes) -> float:
        """Procesa un chunk de audio y devuelve probabilidad de voz (0.0-1.0)."""
        if self.session is None:
            return 0.0
        import numpy as np
        # Convertir int16 bytes a float32 normalizado
        audio = np.frombuffer(pcm_int16, dtype=np.int16).astype(np.float32) / 32768.0
        if len(audio) < self.chunk_size:
            audio = np.pad(audio, (0, self.chunk_size - len(audio)))
        audio = audio[:self.chunk_size].reshape(1, 1, -1)
        ort_inputs = {"input": audio, "state": np.zeros((2, 1, 128), dtype=np.float32)}
        ort_outs = self.session.run(None, ort_inputs)
        speech_prob = float(ort_outs[0][0][0])
        return speech_prob


class WhisperSTT:
    """Speech-to-Text usando faster-whisper (CPU)."""

    def __init__(self, model_size: str = "small"):
        if not _STT_AVAILABLE:
            raise RuntimeError("faster-whisper no instalado. Ejecutá scripts/setup-voice.ps1")
        import os
        model_dir = Path(os.environ.get("BIT_WHISPER_MODEL", ""))
        if model_dir and model_dir.is_dir():
            self.model = WhisperModel(str(model_dir), device="cpu", compute_type="int8")
        else:
            # Descarga automática del modelo (solo la primera vez, en cache de huggingface)
            self.model = WhisperModel(model_size, device="cpu", compute_type="int8")

    def transcribe(self, audio_path: Path) -> str:
        """Transcribe un archivo de audio WAV."""
        segments, _ = self.model.transcribe(str(audio_path), language="es", beam_size=1)
        return " ".join(seg.text for seg in segments).strip()


class AudioRecorder:
    """Grabadora de audio simple usando sounddevice (opcional)."""

    def __init__(self, sample_rate: int = 16000):
        self.sample_rate = sample_rate
        self.recording = False
        self.frames = []
        self._stream = None

    def start(self):
        try:
            import sounddevice as sd
        except ImportError:
            raise RuntimeError("sounddevice no instalado para grabación de micrófono")
        self.frames = []
        self.recording = True
        self._stream = sd.InputStream(
            samplerate=self.sample_rate,
            channels=1,
            dtype="int16",
            callback=self._callback
        )
        self._stream.start()

    def _callback(self, indata, frames, time, status):
        if self.recording:
            self.frames.append(indata.copy())

    def stop(self) -> bytes:
        if self._stream:
            self._stream.stop()
            self._stream.close()
            self._stream = None
        self.recording = False
        import numpy as np
        return np.concatenate(self.frames, axis=0).tobytes() if self.frames else b""


def main() -> int:
    parser = argparse.ArgumentParser(add_help=False)
    parser.add_argument("--model", required=True, help="Ruta al modelo Piper .onnx")
    parser.add_argument("--config", required=False, help="Ruta al config .json de Piper")
    args = parser.parse_args()

    model = Path(args.model).resolve()
    if model.suffix.lower() != ".onnx" or not model.is_file():
        print("modelo Piper inválido", file=sys.stderr)
        return 2

    config = Path(args.config).resolve() if args.config else None
    if config is not None and (config.suffix.lower() != ".json" or not config.is_file()):
        print("configuración Piper inválida", file=sys.stderr)
        return 2

    # Inicializar Piper TTS
    try:
        tts = PiperTTS(model, config)
    except Exception as e:
        print(f"Error cargando Piper: {e}", file=sys.stderr)
        return 3

    # VAD y STT opcionales (se inicializan bajo demanda)
    vad: SileroVAD | None = None
    stt: WhisperSTT | None = None
    recorder: AudioRecorder | None = None

    send({"type": "ready"})

    for raw_line in sys.stdin:
        try:
            request = json.loads(raw_line)
            msg_type = request.get("type")

            if msg_type == "stop":
                # Cancelar cualquier síntesis en curso
                send({"type": "ready"})
                continue

            if msg_type == "speak":
                if not isinstance(request.get("text"), str):
                    send_error("mensaje speak inválido")
                    continue
                text = request["text"]
                for chunk in tts.synthesize(text):
                    send(chunk)
                send({"type": "ready"})
                continue

            if msg_type == "vad-calibrate":
                # Placeholder para calibración de VAD
                if vad is None:
                    try:
                        vad = SileroVAD()
                    except Exception as e:
                        send_error(f"VAD no disponible: {e}")
                        continue
                send({"type": "ready"})
                continue

            if msg_type == "stt-start":
                # Iniciar grabación para STT
                if recorder is None:
                    recorder = AudioRecorder()
                try:
                    recorder.start()
                except Exception as e:
                    send_error(f"Grabación fallida: {e}")
                    continue
                send({"type": "ready"})
                continue

            if msg_type == "stt-stop":
                # Detener grabación y transcribir
                if recorder is None or not recorder.recording:
                    send_error("No hay grabación activa")
                    continue
                audio_data = recorder.stop()
                if not audio_data:
                    send({"type": "transcript", "text": ""})
                    continue
                # Guardar temporalmente
                import tempfile
                with tempfile.NamedTemporaryFile(suffix=".wav", delete=False) as tmp:
                    import wave
                    with wave.open(tmp.name, "wb") as wf:
                        wf.setnchannels(1)
                        wf.setsampwidth(2)
                        wf.setframerate(recorder.sample_rate)
                        wf.writeframes(audio_data)
                    tmp_path = Path(tmp.name)
                try:
                    if stt is None:
                        stt = WhisperSTT()
                    text = stt.transcribe(tmp_path)
                    send({"type": "transcript", "text": text})
                except Exception as e:
                    send_error(f"Transcripción fallida: {e}")
                finally:
                    try:
                        tmp_path.unlink()
                    except OSError:
                        pass
                continue

            # Mensaje desconocido
            send_error(f"tipo de mensaje desconocido: {msg_type}")

        except json.JSONDecodeError:
            send_error("JSON inválido")
        except Exception as error:
            print(f"error sidecar: {error}", file=sys.stderr)
            send_error("error interno")

    return 0


if __name__ == "__main__":
    raise SystemExit(main())