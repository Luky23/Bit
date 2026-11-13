import test from "node:test";
import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { automaticModelDirectories, discoverGgufFiles } from "../src/models/model-discovery.mjs";

test("incluye ubicaciones automáticas de LM Studio, Hugging Face, GPT4All y Jan", () => {
  const roots = automaticModelDirectories({
    home: "C:\\Users\\Luca",
    appData: "C:\\Users\\Luca\\AppData\\Roaming",
    localAppData: "C:\\Users\\Luca\\AppData\\Local",
    userData: "C:\\BitData",
    appPath: "C:\\Bit",
    resourcesPath: "C:\\Bit\\resources",
  }).map((path) => path.toLowerCase());
  assert.ok(roots.some((path) => path.includes(".lmstudio")));
  assert.ok(roots.some((path) => path.includes("huggingface")));
  assert.ok(roots.some((path) => path.includes("gpt4all")));
  assert.ok(roots.some((path) => path.includes("jan")));
});

test("descubre GGUF recursivamente y omite carpetas pesadas", async () => {
  const root = await mkdtemp(join(tmpdir(), "bit-model-discovery-"));
  try {
    await mkdir(join(root, "familia", "modelo"), { recursive: true });
    await mkdir(join(root, "node_modules", "oculto"), { recursive: true });
    await writeFile(join(root, "familia", "modelo", "qwen-q4_k_m.gguf"), "GGUF");
    await writeFile(join(root, "node_modules", "oculto", "ignorado.gguf"), "GGUF");
    await writeFile(join(root, "familia", "notas.txt"), "dato");
    const result = await discoverGgufFiles([root]);
    assert.deepEqual(result.files.map((file) => file.name), ["qwen-q4_k_m.gguf"]);
    assert.equal(result.truncated, false);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
