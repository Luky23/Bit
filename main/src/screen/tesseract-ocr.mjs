import { spawn } from "node:child_process";
import { access } from "node:fs/promises";
import { basename, dirname, join, resolve } from "node:path";

const DEFAULT_TESSERACT = "C:\\Program Files\\Tesseract-OCR\\tesseract.exe";
const OCR_TIMEOUT_MS = 12_000;

function executablePath() {
  return process.env.BIT_TESSERACT_PATH || DEFAULT_TESSERACT;
}

function tessdataPath() {
  return process.env.BIT_TESSDATA_PATH || join(dirname(resolve(executablePath())), "tessdata");
}

function runTesseract(executable, args, timeoutMs = OCR_TIMEOUT_MS, inputBytes = null) {
  return new Promise((resolvePromise, reject) => {
    const child = spawn(executable, args, { shell: false, windowsHide: true });
    let stdout = "";
    let stderr = "";
    const timer = setTimeout(() => {
      child.kill();
      reject(new Error("Tesseract OCR agotó el tiempo de análisis"));
    }, timeoutMs);
    child.stdout.on("data", (chunk) => { stdout += chunk.toString("utf8"); });
    child.stderr.on("data", (chunk) => { stderr += chunk.toString("utf8"); });
    child.once("error", (error) => { clearTimeout(timer); reject(error); });
    child.once("close", (code) => {
      clearTimeout(timer);
      if (code !== 0) reject(new Error(stderr.trim() || `Tesseract terminó con código ${code}`));
      else resolvePromise(stdout.normalize("NFC").trim());
    });
    if (inputBytes) child.stdin.end(inputBytes);
    else child.stdin.end();
  });
}

export async function analyzeImageWithTesseract({ imageBase64, maxChars = 6000 } = {}) {
  if (typeof imageBase64 !== "string" || !/^[A-Za-z0-9+/]+={0,2}$/u.test(imageBase64)) {
    throw new Error("La imagen para OCR no es válida");
  }
  const executable = resolve(executablePath());
  if (basename(executable).toLowerCase() !== "tesseract.exe") {
    throw new Error("La ruta de Tesseract no es válida");
  }
  const dataDir = resolve(tessdataPath());
  const languages = await availableOcrLanguages(dataDir);
  const text = await runTesseract(executable, ["stdin", "stdout", "--tessdata-dir", dataDir, "-l", languages, "--oem", "1", "--psm", "11"], OCR_TIMEOUT_MS, Buffer.from(imageBase64, "base64"));
  return cleanOcrText(text).slice(0, maxChars);
}

/** Devuelve palabras OCR y sus cajas en píxeles de la imagen de entrada. */
export async function analyzeImageWithTesseractBoxes({ imageBase64, maxBoxes = 500 } = {}) {
  if (typeof imageBase64 !== "string" || !/^[A-Za-z0-9+/]+={0,2}$/u.test(imageBase64)) {
    throw new Error("La imagen para OCR no es válida");
  }
  const executable = resolve(executablePath());
  if (basename(executable).toLowerCase() !== "tesseract.exe") throw new Error("La ruta de Tesseract no es válida");
  const dataDir = resolve(tessdataPath());
  const languages = await availableOcrLanguages(dataDir);
  const tsv = await runTesseract(executable, ["stdin", "stdout", "tsv", "--tessdata-dir", dataDir, "-l", languages, "--oem", "1", "--psm", "11"], OCR_TIMEOUT_MS, Buffer.from(imageBase64, "base64"));
  return parseTesseractTsv(tsv).slice(0, maxBoxes);
}

export function parseTesseractTsv(tsv) {
  const lines = String(tsv).split(/\r?\n/gu);
  const header = lines.shift()?.split("\t") || [];
  const index = Object.fromEntries(header.map((name, position) => [name, position]));
  return lines.map((line) => {
    const parts = line.split("\t");
    const text = parts[index.text]?.trim() || "";
    const confidence = Number(parts[index.conf]);
    const x = Number(parts[index.left]); const y = Number(parts[index.top]);
    const width = Number(parts[index.width]); const height = Number(parts[index.height]);
    return { text, confidence, x, y, width, height };
  }).filter((box) => box.text && Number.isFinite(box.confidence) && box.confidence >= 0 && Number.isFinite(box.x) && Number.isFinite(box.y) && Number.isFinite(box.width) && Number.isFinite(box.height) && box.width > 0 && box.height > 0);
}

export async function availableOcrLanguages(dataDir) {
  const installed = [];
  for (const language of ["spa", "eng"]) {
    try {
      await access(join(dataDir, `${language}.traineddata`));
      installed.push(language);
    } catch { /* El idioma no está instalado. */ }
  }
  if (!installed.length) throw new Error("Tesseract no tiene datos de idioma español ni inglés instalados");
  return installed.join("+");
}

export function cleanOcrText(text) {
  const lines = text.split(/\r?\n/gu).map((line) => line.trim()).filter(Boolean);
  const useful = lines.filter((line) => {
    if (line.length < 2) return false;
    const letters = (line.match(/[A-Za-zÁÉÍÓÚÜÑáéíóúüñ]/gu) || []).length;
    const symbols = (line.match(/[^\p{L}\p{N}\s.,:;!?¡¿()/%+\-_'"@]/gu) || []).length;
    const tokens = line.split(/\s+/u).filter(Boolean);
    const shortTokens = tokens.filter((token) => token.replace(/[^\p{L}\p{N}]/gu, "").length <= 2).length;
    const hasRepeatedNoise = /(?:^|\s)[=><|]{2,}|([A-Za-z])\1{3,}/iu.test(line);
    return letters >= 3 && symbols <= Math.max(2, Math.floor(line.length / 5)) && shortTokens <= Math.ceil(tokens.length * 0.55) && !hasRepeatedNoise;
  });
  return useful.join(" ").replace(/\s+/gu, " ").trim();
}

export function getTesseractConfig() {
  return { executable: executablePath(), tessdata: tessdataPath() };
}
