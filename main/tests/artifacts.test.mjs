import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  createArtifactDelivery,
  renderHtmlArtifact,
  validateRenderedHtml,
} from "../src/artifacts/delivery.mjs";

const SPEC = Object.freeze({
  title: "Informe de Bit",
  subtitle: "Resumen local y privado",
  sections: [
    { heading: "Estado", paragraphs: ["Todos los sistemas locales están listos."] },
    { heading: "Siguiente paso", paragraphs: ["Revisar el resultado antes de compartirlo."] },
  ],
  accent: "#65d6ff",
});

test("artifacts: renderiza HTML autocontenido con CSP y contenido escapado", () => {
  const html = renderHtmlArtifact({
    ...SPEC,
    title: "Bit <privado>",
    sections: [{ heading: "Seguridad", paragraphs: ["<script>alert(1)</script>"] }],
  });

  assert.match(html, /default-src 'none'/u);
  assert.match(html, /connect-src 'none'/u);
  assert.match(html, /form-action 'none'/u);
  assert.match(html, /Bit &lt;privado&gt;/u);
  assert.match(html, /&lt;script&gt;alert\(1\)&lt;\/script&gt;/u);
  assert.doesNotMatch(html, /<script[\s>]/iu);
  assert.deepEqual(validateRenderedHtml(html), { ok: true });
});

test("artifacts: rechaza especificaciones desconocidas o peligrosas", () => {
  assert.throws(() => renderHtmlArtifact({ ...SPEC, script: "alert(1)" }), /campo no permitido/iu);
  assert.throws(() => renderHtmlArtifact({ ...SPEC, accent: "red; background:url(https://example.com)" }), /color/iu);
  assert.throws(
    () => renderHtmlArtifact({ ...SPEC, sections: [{ heading: "Web", paragraphs: ["fetch('https://example.com')"] }] }),
    /contenido activo/iu,
  );
});

test("artifacts: el validador bloquea red, iframes y APIs activas", () => {
  for (const unsafe of [
    '<iframe src="https://example.com"></iframe>',
    '<img src="https://example.com/a.png">',
    '<script>fetch("https://example.com")</script>',
    '<form action="https://example.com"></form>',
    '<div onclick="alert(1)">x</div>',
  ]) {
    assert.equal(validateRenderedHtml(unsafe).ok, false, unsafe);
  }
});

test("artifacts: crea una entrega versionada con manifiesto y sin sobrescribir", async () => {
  const root = await mkdtemp(join(tmpdir(), "bit-artifacts-test-"));
  const now = () => new Date("2026-11-06T12:00:00-03:00");
  try {
    const html = renderHtmlArtifact(SPEC);
    const first = await createArtifactDelivery({ root, name: "Informe mensual", kind: "html", files: { "index.html": html }, spec: SPEC, now });
    const second = await createArtifactDelivery({ root, name: "Informe mensual", kind: "html", files: { "index.html": html }, spec: SPEC, now });

    assert.equal(first.folderName, "2026-11-06_informe-mensual");
    assert.equal(second.folderName, "2026-11-06_informe-mensual (2)");
    assert.equal(await readFile(join(first.path, "index.html"), "utf8"), html);
    const manifest = JSON.parse(await readFile(join(first.path, ".bit.json"), "utf8"));
    assert.equal(manifest.kind, "html");
    assert.equal(manifest.version, 1);
    assert.deepEqual(manifest.files, ["index.html"]);
    assert.deepEqual(manifest.spec, SPEC);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("artifacts: acepta bytes PDF pero bloquea nombres y rutas no permitidos", async () => {
  const root = await mkdtemp(join(tmpdir(), "bit-artifacts-test-"));
  try {
    const result = await createArtifactDelivery({
      root,
      name: "Reporte",
      kind: "pdf",
      files: { "reporte.pdf": new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d]) },
      spec: SPEC,
    });
    assert.deepEqual(new Uint8Array(await readFile(join(result.path, "reporte.pdf"))), new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d]));
    await assert.rejects(
      createArtifactDelivery({ root, name: "Malo", kind: "html", files: { "../escape.html": "x" }, spec: SPEC }),
      /nombre de archivo/iu,
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
