import test from "node:test";
import assert from "node:assert/strict";
import { access, readFile } from "node:fs/promises";

test("el iniciador visible se llama Bit y oculta los scripts internos", async () => {
  const root = new URL("../../", import.meta.url);
  const vbs = await readFile(new URL("scripts/bit-launch.vbs", root), "utf8");
  const batch = await readFile(new URL("scripts/bit-launch.bat", root), "utf8");

  await access(new URL("Bit.lnk", root));
  await access(new URL("main/electron/assets/bit.ico", root));
  await assert.rejects(access(new URL("Bit-Silencioso.vbs", root)));
  await assert.rejects(access(new URL("Iniciar-Bit.bat", root)));
  assert.match(vbs, /Fso\.BuildPath\(ScriptsDir, "bit-launch\.bat"\)/u);
  assert.match(batch, /npm\.cmd start/u);
});
