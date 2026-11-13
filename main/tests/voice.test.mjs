import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { JsonlFramer, encodeVoiceMessage, parseVoiceLine } from "../src/voice/protocol.mjs";
import { prepareSpeechText, SpeechQueue, splitSentences } from "../src/voice/speech.mjs";
import { isAllowedAudioFile, validateVoiceSettings } from "../src/voice/settings.mjs";
import { localVoiceDirectories } from "../src/core/config.mjs";

test("las voces locales incluyen la instalación privada existente de Bit", () => {
  assert.deepEqual(localVoiceDirectories({
    userData: "C:\\Users\\Luca\\AppData\\Roaming\\Bit Preview",
    appPath: "C:\\Bit",
    resourcesPath: "C:\\Bit\\resources",
    localAppData: "C:\\Users\\Luca\\AppData\\Local",
  }), [
    "C:\\Users\\Luca\\AppData\\Roaming\\Bit Preview\\voices",
    "C:\\Bit\\voices",
    "C:\\Bit\\resources\\voices",
    "C:\\Users\\Luca\\AppData\\Local\\Bit\\voices",
    "C:\\Users\\Luca\\AppData\\Local\\Bit\\Piper\\voices",
  ]);
});

test("protocolo de voz valida y enmarca JSONL", () => {
  const framer = new JsonlFramer();
  const line = encodeVoiceMessage({ type: "speak", text: "Hola." });
  assert.deepEqual(framer.push(line.slice(0, 4)), []);
  assert.deepEqual(framer.push(line.slice(4)), [{ type: "speak", text: "Hola." }]);
  assert.throws(() => parseVoiceLine(JSON.stringify({ type: "speak" })), /sin texto/);
  assert.throws(() => parseVoiceLine(JSON.stringify({ type: "stt-configure" })), /modelPath/);
  assert.deepEqual(
    parseVoiceLine(JSON.stringify({ type: "stt-configure", modelPath: "C:\\models\\whisper" })),
    { type: "stt-configure", modelPath: "C:\\models\\whisper" }
  );
});

test("la respuesta se segmenta por oración y puede interrumpirse", async () => {
  assert.deepEqual(splitSentences("Uno. Dos! Tres?"), ["Uno.", "Dos!", "Tres?"]);
  const spoken = [];
  const queue = new SpeechQueue(async (msg) => { spoken.push(msg); });
  queue.enqueue("Primera. Segunda.");
  await new Promise((resolve) => setTimeout(resolve, 0));
  // La cola ahora envía mensajes JSONL codificados
  assert.equal(spoken.length, 2);
  assert.ok(spoken[0].includes('"type":"speak"'));
  assert.ok(spoken[0].includes('"text":"Primera."'));
  assert.ok(spoken[1].includes('"text":"Segunda."'));
  queue.enqueue("No debe salir.");
  queue.cancel();
  assert.equal(queue.items.length, 0);
});

test("una respuesta nueva reemplaza la voz anterior pendiente", async () => {
  const spoken = [];
  const queue = new SpeechQueue((message) => spoken.push(JSON.parse(message)), { waitForReady: true });

  queue.enqueue("Respuesta vieja. Otra frase vieja.");
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.equal(queue.isWaitingForReady, true);
  assert.deepEqual(spoken.map((message) => message.text), ["Respuesta vieja."]);

  queue.enqueue("Hola, Señor. ¿En qué puedo ayudarle?", "Señor");
  queue.notifyReady();
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.deepEqual(spoken.map((message) => message.text), ["Respuesta vieja.", "Hola, Señor."]);

  queue.notifyReady();
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.deepEqual(spoken.map((message) => message.text), [
    "Respuesta vieja.",
    "Hola, Señor.",
    "En qué puedo ayudarle?",
  ]);
  queue.notifyReady();
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.equal(queue.isActive, false);
});

test("la cola de voz espera hasta que el sidecar termina de sintetizar", async () => {
  const spoken = [];
  const queue = new SpeechQueue((message) => spoken.push(JSON.parse(message)), { waitForReady: true });

  queue.enqueue("Saludo de inicio.");
  const idle = queue.waitForIdle();
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.equal(queue.isActive, true);
  assert.deepEqual(spoken.map((message) => message.text), ["Saludo de inicio."]);

  queue.notifyReady();
  await idle;
  assert.equal(queue.isActive, false);
});

test("un error del sidecar rechaza la espera de la cola de voz", async () => {
  const queue = new SpeechQueue(() => {}, { waitForReady: true });
  queue.enqueue("Saludo de inicio.");
  const idle = queue.waitForIdle();
  await new Promise((resolve) => setTimeout(resolve, 0));
  queue.notifyError(new Error("Piper no está configurado"));
  await assert.rejects(idle, /Piper no está configurado/);
});

test("la voz omite código y formato sin alterar el texto visible del chat", async () => {
  assert.equal(
    prepareSpeechText("La respuesta es **sí**.\n```js\nconst total = 2;\n```\nConsulte [la guía](https://example.com)."),
    "La respuesta es sí. Consulte la guía."
  );
  assert.equal(
    prepareSpeechText("```js\nconst total = 2;\n```"),
    "La respuesta incluye código que puede consultar en el chat."
  );
  assert.equal(
    prepareSpeechText("Resultado:\nconsole.log(total);\nLa operación terminó correctamente."),
    "Resultado: La operación terminó correctamente."
  );
  assert.equal(
    prepareSpeechText("La solución aplica esta regla:\n- if (count > 0) {\n  console.log(count);\n}\nDespués, continúa normalmente."),
    "La solución aplica esta regla: Después, continúa normalmente."
  );
  assert.equal(
    prepareSpeechText("La respuesta es:\n{\"ok\": true, \"count\": 2}\nTodo quedó guardado."),
    "La respuesta es: Todo quedó guardado."
  );
  assert.equal(
    prepareSpeechText("El símbolo ^ aparece en x^2 y también queda ** marcado."),
    "El símbolo aparece en x 2 y también queda marcado."
  );
  assert.equal(
    prepareSpeechText("El símbolo ˆ aparece aquí."),
    "El símbolo aparece aquí."
  );
  assert.equal(
    prepareSpeechText("El símbolo ˇ tampoco debe ser nombrado."),
    "El símbolo tampoco debe ser nombrado."
  );
  assert.equal(
    prepareSpeechText("El símbolo ˄ y el operador _ no deben leerse."),
    "El símbolo y el operador no deben leerse."
  );
  assert.equal(
    prepareSpeechText('El carácter ^, el copyright © y las comillas "dobles" y “tipográficas”.'),
    "El carácter, el copyright y las comillas dobles y tipográficas."
  );
  assert.equal(prepareSpeechText("Por supuesto. ¿En qué puedo ayudarle?", "Lucía"), "Lucía, por supuesto. En qué puedo ayudarle?");
  assert.equal(prepareSpeechText("Hola, Lucía. ¿En qué puedo ayudarle?", "Lucía"), "Hola, Lucía. En qué puedo ayudarle?");
  assert.equal(
    prepareSpeechText("Hola, Sen\u0303or. ¿En qué puedo ayudarle?", "Sen\u0303or"),
    "Hola, Señor. En qué puedo ayudarle?"
  );
  assert.equal(prepareSpeechText("Hola.", "Lucíaˇ"), "Lucía, hola.");
  assert.equal(prepareSpeechText("¡Hola! ¿En qué puedo ayudarle?"), "Hola! En qué puedo ayudarle?");

  const spoken = [];
  const queue = new SpeechQueue((message) => spoken.push(JSON.parse(message)));
  queue.enqueue("Hola **mundo**. ```js\nconst total = 2;\n```", "Lucía");
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.deepEqual(spoken.map((message) => message.text), ["Lucía, hola mundo."]);
});

test("voz ajusta endpointing y limita extensiones de audio", () => {
  assert.equal(validateVoiceSettings({ vadEndpointMs: 100 }).vadEndpointMs, 500);
  assert.equal(validateVoiceSettings({ vadEndpointMs: 999 }).vadEndpointMs, 700);
  assert.equal(isAllowedAudioFile("saludo.wav"), true);
  assert.equal(isAllowedAudioFile("programa.exe"), false);
});

test("main resuelve un sidecar Piper empaquetado y conserva fallback de desarrollo", async () => {
  const source = await readFile(new URL("../electron/main.mjs", import.meta.url), "utf8");

  assert.match(source, /const sidecarDir = app\.isPackaged \? join\(process\.resourcesPath, "voice-sidecar"\) : join\(here, "\.\.", "voice-sidecar"\)/);
  assert.match(source, /const executable = join\(sidecarDir, "piper-sidecar\.exe"\)/);
  assert.match(source, /python: join\(sidecarDir, "\.venv", "Scripts", "python\.exe"\)/);
  assert.match(source, /sidecar: join\(sidecarDir, "sidecar\.py"\)/);
  assert.match(source, /spawn\(paths\.executable \|\| paths\.python, args/);
});

test("Piper es opcional al iniciar y admite una voz ONNX sin JSON lateral", async () => {
  const source = await readFile(new URL("../electron/main.mjs", import.meta.url), "utf8");

  assert.match(source, /available: Boolean\(voice\)/u);
  assert.match(source, /if \(paths\.available && existsSync\(paths\.model\)\)/u);
  assert.match(source, /if \(existsSync\(paths\.config\)\) args\.push\("--config", paths\.config\)/u);
  assert.match(source, /if \(!paths\.available\) \{/u);
});

test("sidecar: fija UTF-8 para conservar tildes en la tubería local", async () => {
  const source = await readFile(new URL("../voice-sidecar/sidecar.py", import.meta.url), "utf8");
  assert.match(source, /sys\.stdin\.reconfigure\(encoding="utf-8"\)/u);
  assert.match(source, /sys\.stdout\.reconfigure\(encoding="utf-8"\)/u);
});

test("Piper aplica un perfil de voz sereno y de ritmo medido", async () => {
  const source = await readFile(new URL("../voice-sidecar/sidecar.py", import.meta.url), "utf8");

  assert.match(source, /SynthesisConfig\(length_scale=1\.12, noise_scale=0\.55, noise_w_scale=0\.65\)/);
  assert.match(source, /self\.voice\.synthesize\(text, syn_config=self\.synthesis_config\)/);
});

test("STT solo abre el modelo local seleccionado y no descarga modelos por nombre", async () => {
  const source = await readFile(new URL("../voice-sidecar/sidecar.py", import.meta.url), "utf8");

  assert.match(source, /class WhisperSTT:\s+"""Speech-to-Text usando faster-whisper \(CPU\)\."""\s+def __init__\(self, model_dir: Path \| None\):/);
  assert.match(source, /WhisperModel\(str\(model_dir\), device="cpu", compute_type="int8", local_files_only=True\)/);
  assert.match(source, /WhisperSTT\(whisper_model\)/);
  assert.doesNotMatch(source, /WhisperModel\(model_size/);
  assert.match(source, /parser\.add_argument\("--model", required=False/);
  assert.match(source, /if tts is None:\s+send_error\("Voz Piper no configurada/);
  assert.match(source, /with tempfile\.NamedTemporaryFile\(suffix="\.wav", delete=False\) as tmp:\s+tmp_path = Path\(tmp\.name\)\s+with wave\.open\(str\(tmp_path\), "wb"\)/);
});

test("el instalador de voz no descarga modelos al ejecutarse", async () => {
  const source = await readFile(new URL("../../scripts/setup-voice.ps1", import.meta.url), "utf8");

  assert.doesNotMatch(source, /Invoke-WebRequest|DownloadString|Descargando modelo/);
  assert.match(source, /Bit no descarga modelos STT automaticamente/);
  assert.match(source, /Selecciona la carpeta desde Ajustes/);
});
