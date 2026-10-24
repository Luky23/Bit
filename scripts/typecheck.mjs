import { readdir } from "node:fs/promises";
import { join, relative } from "node:path";

async function files(dir) {
  const result = [];
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) result.push(...await files(path));
    else if (path.endsWith(".mjs")) result.push(path);
  }
  return result;
}

// Importar los módulos es una verificación real de sintaxis y resolución ESM,
// sin child_process, dependencias ni red. Los tests ejercitan el comportamiento.
const sourceRoot = join(process.cwd(), "main", "src");
const targets = await files(sourceRoot);
for (const target of targets) await import(`file://${target.replaceAll("\\", "/")}`);
console.log(`typecheck estructural: ${targets.length} módulos ESM importados correctamente`);
