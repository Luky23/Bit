import { access, readFile } from "node:fs/promises";

const requiredPackages = ["pdf-parse", "mammoth", "exceljs", "officeparser", "node-llama-cpp"];
const packageJson = JSON.parse(await readFile(new URL("../package.json", import.meta.url), "utf8"));
const lock = JSON.parse(await readFile(new URL("../package-lock.json", import.meta.url), "utf8"));
const missing = [];

for (const packageName of requiredPackages) {
  try {
    await access(new URL(`../node_modules/${packageName}/package.json`, import.meta.url));
  } catch {
    missing.push(packageName);
  }
}

const declared = packageJson.dependencies || {};
const locked = lock.packages?.[""]?.dependencies || {};
const unsynced = requiredPackages.filter((packageName) => declared[packageName] && locked[packageName] !== declared[packageName]);

if (missing.length || unsynced.length) {
  const details = [
    missing.length ? `faltan en node_modules: ${missing.join(", ")}` : "",
    unsynced.length ? `package-lock.json desincronizado: ${unsynced.join(", ")}` : "",
  ].filter(Boolean).join("; ");
  throw new Error(`No se puede crear un instalador completo: ${details}. Ejecute npm install y vuelva a verificar.`);
}

console.log("Preflight correcto: dependencias de producción y lockfile disponibles para el instalador.");
