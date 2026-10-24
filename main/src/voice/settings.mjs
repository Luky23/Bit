const AUDIO_EXTENSIONS = new Set([".mp3", ".wav", ".ogg", ".m4a", ".flac"]);

export function validateVoiceSettings(input = {}) {
  const result = {
    enabled: input.enabled === true,
    microphoneId: typeof input.microphoneId === "string" ? input.microphoneId.slice(0, 256) : "",
    piperPath: typeof input.piperPath === "string" ? input.piperPath : "",
    voiceModelPath: typeof input.voiceModelPath === "string" ? input.voiceModelPath : "",
    vadEndpointMs: Math.min(700, Math.max(500, Number(input.vadEndpointMs) || 600)),
    pushToTalk: typeof input.pushToTalk === "string" ? input.pushToTalk : "Control+Alt+V",
    wakeWord: input.wakeWord === true
  };
  return result;
}

export function isAllowedAudioFile(filePath) {
  const extension = filePath.slice(filePath.lastIndexOf(".")).toLowerCase();
  return AUDIO_EXTENSIONS.has(extension);
}
