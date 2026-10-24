"""Sidecar Piper local: JSONL por stdin/stdout, sin sockets ni shell."""

from __future__ import annotations

import argparse
import base64
import json
import sys
from pathlib import Path

from piper import PiperVoice


def send(message: dict[str, object]) -> None:
    sys.stdout.write(json.dumps(message, ensure_ascii=False) + "\n")
    sys.stdout.flush()


def main() -> int:
    parser = argparse.ArgumentParser(add_help=False)
    parser.add_argument("--model", required=True)
    parser.add_argument("--config", required=False)
    args = parser.parse_args()
    model = Path(args.model).resolve()
    if model.suffix.lower() != ".onnx" or not model.is_file():
        print("modelo Piper inválido", file=sys.stderr)
        return 2
    config = Path(args.config).resolve() if args.config else None
    if config is not None and (config.suffix.lower() != ".json" or not config.is_file()):
        print("configuración Piper inválida", file=sys.stderr)
        return 2
    voice = PiperVoice.load(str(model), config_path=str(config) if config else None)
    send({"type": "ready"})
    for raw_line in sys.stdin:
        try:
            request = json.loads(raw_line)
            if request.get("type") == "stop":
                send({"type": "ready"})
                continue
            if request.get("type") != "speak" or not isinstance(request.get("text"), str):
                send({"type": "error", "error": "mensaje speak inválido"})
                continue
            for chunk in voice.synthesize(request["text"]):
                send({
                    "type": "audio",
                    "sampleRate": chunk.sample_rate,
                    "sampleWidth": chunk.sample_width,
                    "channels": chunk.sample_channels,
                    "pcmBase64": base64.b64encode(chunk.audio_int16_bytes).decode("ascii"),
                })
            send({"type": "ready"})
        except Exception as error:  # noqa: BLE001 - el protocolo debe sobrevivir a un pedido inválido
            print(f"error Piper: {error}", file=sys.stderr)
            send({"type": "error", "error": "síntesis fallida"})
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
