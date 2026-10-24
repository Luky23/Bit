const MAX_IMAGE_BYTES = 12 * 1024 * 1024;
const IMAGE_DATA_URL = /^data:image\/(png|jpeg|webp);base64,([A-Za-z0-9+/=\r\n]+)$/;

export function imageDataUrlToBase64(value) {
  if (typeof value !== "string") return null;
  const match = IMAGE_DATA_URL.exec(value.trim());
  if (!match) return null;
  const base64 = match[2].replaceAll(/\s/g, "");
  if (!base64 || Math.ceil((base64.length * 3) / 4) > MAX_IMAGE_BYTES) return null;
  return base64;
}

export function createVisionMessage(text, imageDataUrl) {
  const content = typeof text === "string" ? text.trim().slice(0, 8000) : "";
  const image = imageDataUrlToBase64(imageDataUrl);
  if (!content) throw new Error("Escribí una pregunta para la pantalla");
  if (!image) throw new Error("La captura de pantalla no es válida o es demasiado grande");
  return { role: "user", content, images: [image] };
}

