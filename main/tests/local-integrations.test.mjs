import test from "node:test";
import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { listInstalledApps, resolveInstalledApp } from "../src/core/local-integrations.mjs";

test("descubre accesos del menú Inicio y excluye instaladores", async () => {
  const root = await mkdtemp(join(tmpdir(), "bit-apps-"));
  const common = join(root, "common");
  const roaming = join(root, "roaming");
  const commonMenu = join(common, "Microsoft", "Windows", "Start Menu", "Programs");
  const userMenu = join(roaming, "Microsoft", "Windows", "Start Menu", "Programs");
  try {
    await mkdir(join(commonMenu, "Herramientas"), { recursive: true });
    await mkdir(userMenu, { recursive: true });
    await writeFile(join(commonMenu, "Herramientas", "Editor Local.lnk"), "shortcut");
    await writeFile(join(userMenu, "Editor Local.lnk"), "shortcut duplicado");
    await writeFile(join(userMenu, "Uninstall Editor.lnk"), "shortcut");
    const env = { PROGRAMDATA: common, APPDATA: roaming };
    assert.deepEqual((await listInstalledApps({ query: "editor", env })).map((app) => app.name), ["Editor Local"]);
    assert.equal((await resolveInstalledApp("Editor Local", { env }))?.name, "Editor Local");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
