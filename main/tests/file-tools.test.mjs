import test from "node:test";
import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  MAX_FILE_BYTES,
  WRITABLE_EXTENSIONS,
  createFile,
  createParametricStl,
  isSafeToOpenExternally,
  modifyFile,
  previewDroppedFile,
  readTextFile,
  searchFiles,
} from "../src/core/file-tools.mjs";

test("genera sólidos STL paramétricos con dimensiones y volumen exactos", () => {
  const box = createParametricStl({ shape: "box", x: 20, y: 10, z: 5 });
  assert.deepEqual(box.metadata.dimensions, { x: 20, y: 5, z: 10, unit: "mm" });
  assert.equal(box.metadata.volumeMm3, 1000);
  assert.equal(box.metadata.triangleCount, 12);
  assert.match(box.content, /^solid bit_parametric/u);
  const cylinder = createParametricStl({ shape: "cylinder", diameter: 10, z: 20, segments: 24 });
  assert.equal(cylinder.metadata.triangleCount, 96);
  assert.ok(Math.abs(cylinder.metadata.volumeMm3 - Math.PI * 500) < 1e-9);
});

async function withRoot(run) {
  const root = await mkdtemp(join(tmpdir(), "bit-filetools-"));
  try {
    return await run(root);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

test("createFile escribe un archivo .js dentro del sandbox", () =>
  withRoot(async (root) => {
    const result = await createFile({ root, path: "src/saludo.js", content: "console.log('hola');\n" });
    assert.equal(result.ok, true);
    assert.equal(result.created, true);
    assert.ok(result.absolutePath.endsWith("saludo.js"));
    assert.equal(await readFile(result.absolutePath, "utf8"), "console.log('hola');\n");
    assert.equal(result.bytes, Buffer.byteLength("console.log('hola');\n", "utf8"));
  }));

test("previewDroppedFile devuelve una vista previa local para texto y PDF", () =>
  withRoot(async (root) => {
    const textPath = join(root, "nota.txt");
    const pdfPath = join(root, "ficha.pdf");
    await writeFile(textPath, "Bit puede mostrar este texto.", "utf8");
    await writeFile(pdfPath, Buffer.from("%PDF-1.4\n", "ascii"));
    const text = await previewDroppedFile(textPath);
    assert.equal(text.kind, "text");
    assert.equal(text.content, "Bit puede mostrar este texto.");
    const pdf = await previewDroppedFile(pdfPath);
    assert.equal(pdf.kind, "pdf");
    assert.match(pdf.fileUrl, /^file:.*view=fit.*toolbar=0/u);
    assert.match(pdf.dataUrl, /^data:application\/pdf;base64,/u);
  }));

test("previewDroppedFile identifica los modelos 3D, incluido 3MF", () =>
  withRoot(async (root) => {
    const modelPath = join(root, "Pieza chica 195mm.3MF");
    await writeFile(modelPath, Buffer.from("3MF"));
    const model = await previewDroppedFile(modelPath);
    assert.equal(model.kind, "model3d");
    assert.match(model.notice, /visor 3D/u);
  }));

test("createFile crea las carpetas padre que falten", () =>
  withRoot(async (root) => {
    const result = await createFile({ root, path: "a/b/c/indice.html", content: "<!doctype html>" });
    assert.equal(result.ok, true);
    assert.ok((await stat(result.absolutePath)).isFile());
  }));

test("createFile RECHAZA path traversal fuera del sandbox", () =>
  withRoot(async (root) => {
    await assert.rejects(() => createFile({ root, path: "../fuera.js", content: "x" }));
    await assert.rejects(() => createFile({ root, path: "a/../../fuera.js", content: "x" }));
    await assert.rejects(() => createFile({ root, path: "C:\\Windows\\System32\\evil.js", content: "x" }));
  }));

test("createFile RECHAZA extensiones que no son de código ni de texto", () =>
  withRoot(async (root) => {
    for (const path of ["peligroso.exe", "arranque.bat", "script.vbs", "lib.dll", "sin-extension"]) {
      await assert.rejects(() => createFile({ root, path, content: "x" }), path);
    }
  }));

test("createFile NO sobrescribe un archivo existente salvo que se pida overwrite", () =>
  withRoot(async (root) => {
    await createFile({ root, path: "config.json", content: '{"a":1}' });
    await assert.rejects(() => createFile({ root, path: "config.json", content: '{"a":2}' }));
    const result = await createFile({ root, path: "config.json", content: '{"a":2}', overwrite: true });
    assert.equal(result.ok, true);
    assert.equal(result.created, false);
    assert.equal(await readFile(result.absolutePath, "utf8"), '{"a":2}');
  }));

test("createFile RECHAZA contenido binario o demasiado grande", () =>
  withRoot(async (root) => {
    await assert.rejects(() => createFile({ root, path: "a.txt", content: "con\u0000nulo" }));
    const huge = "x".repeat(MAX_FILE_BYTES + 1);
    await assert.rejects(() => createFile({ root, path: "grande.txt", content: huge }));
  }));

test("createFile RECHAZA escribir dentro de la carpeta de respaldos", () =>
  withRoot(async (root) => {
    await assert.rejects(() => createFile({ root, path: ".bit-backups/archivo.txt", content: "x" }));
  }));

test("modifyFile reemplaza el contenido y conserva un respaldo del previo", () =>
  withRoot(async (root) => {
    const first = await createFile({ root, path: "estilo.css", content: "body{color:red}" });
    const result = await modifyFile({ root, path: "estilo.css", content: "body{color:cyan}" });
    assert.equal(result.ok, true);
    assert.equal(await readFile(first.absolutePath, "utf8"), "body{color:cyan}");
    assert.ok(result.backupId, "debe devolver un identificador de respaldo");
    assert.equal(result.previousBytes, Buffer.byteLength("body{color:red}", "utf8"));
  }));

test("modifyFile RECHAZA un archivo que no existe", () =>
  withRoot(async (root) => {
    await assert.rejects(() => modifyFile({ root, path: "no-existe.js", content: "x" }));
  }));

test("modifyFile RECHAZA rutas fuera del sandbox", () =>
  withRoot(async (root) => {
    await assert.rejects(() => modifyFile({ root, path: "../afuera.txt", content: "x" }));
  }));

test("readTextFile devuelve el contenido UTF-8", () =>
  withRoot(async (root) => {
    await createFile({ root, path: "notas.md", content: "# Ñandú\n" });
    const result = await readTextFile({ root, path: "notas.md" });
    assert.equal(result.ok, true);
    assert.equal(result.content, "# Ñandú\n");
  }));

test("readTextFile RECHAZA archivos binarios y rutas fuera del sandbox", () =>
  withRoot(async (root) => {
    const binaryPath = join(root, "imagen.png");
    await writeFile(binaryPath, Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x00, 0x01]));
    await assert.rejects(() => readTextFile({ root, path: "imagen.png" }));
    await assert.rejects(() => readTextFile({ root, path: "../afuera.txt" }));
  }));

test("solo las extensiones declaradas se pueden crear", () => {
  assert.ok(WRITABLE_EXTENSIONS.has(".js"));
  assert.ok(WRITABLE_EXTENSIONS.has(".py"));
  assert.ok(WRITABLE_EXTENSIONS.has(".html"));
  assert.ok(WRITABLE_EXTENSIONS.has(".css"));
  assert.equal(WRITABLE_EXTENSIONS.has(".exe"), false);
});

test("isSafeToOpenExternally distingue código ejecutable de documento", () => {
  assert.equal(isSafeToOpenExternally("informe.md"), true);
  assert.equal(isSafeToOpenExternally("datos.csv"), true);
  assert.equal(isSafeToOpenExternally("app.js"), false);
  assert.equal(isSafeToOpenExternally("script.py"), false);
  assert.equal(isSafeToOpenExternally("pagina.html"), false);
});

test("searchFiles busca por nombre y extensión sin exponer rutas absolutas", () =>
  withRoot(async (root) => {
    await mkdir(join(root, "documentos"), { recursive: true });
    await writeFile(join(root, "documentos", "Informe final.PDF"), "contenido", "utf8");
    await writeFile(join(root, "documentos", "informe.txt"), "contenido", "utf8");

    const result = await searchFiles({ query: "informe", extension: "pdf", targetDir: root });
    assert.equal(result.ok, true);
    assert.equal(result.results.length, 1);
    assert.equal(result.results[0].name, "Informe final.PDF");
    assert.equal(result.results[0].path, "documentos/Informe final.PDF");
    assert.equal(result.results[0].size, Buffer.byteLength("contenido", "utf8"));
    assert.ok(Number.isFinite(Date.parse(result.results[0].modifiedAt)));
    assert.equal(result.results[0].path.includes(root), false);
  }));

test("searchFiles omite directorios pesados y exige un término o extensión", () =>
  withRoot(async (root) => {
    await mkdir(join(root, "node_modules", "paquete"), { recursive: true });
    await writeFile(join(root, "node_modules", "paquete", "informe.pdf"), "no debe aparecer", "utf8");
    await assert.rejects(() => searchFiles({ query: "", targetDir: root }));
    const result = await searchFiles({ query: "informe", targetDir: root });
    assert.deepEqual(result.results, []);
  }));
