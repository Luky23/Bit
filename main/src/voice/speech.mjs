export function splitSentences(text) {
  return String(text ?? "").replace(/\s+/g, " ").trim().match(/[^.!?…]+(?:[.!?…]+|$)/g)?.map((item) => item.trim()).filter(Boolean) ?? [];
}

export class SpeechQueue {
  constructor(speak) { this.speak = speak; this.items = []; this.running = false; this.cancelled = false; }
  enqueue(text) { this.cancelled = false; this.items.push(...splitSentences(text)); void this.#drain(); }
  cancel() { this.cancelled = true; this.items.length = 0; }
  async #drain() {
    if (this.running) return;
    this.running = true;
    try {
      while (!this.cancelled && this.items.length) await this.speak(this.items.shift());
    } finally { this.running = false; }
  }
}
