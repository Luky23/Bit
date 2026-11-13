import test from "node:test";
import assert from "node:assert/strict";
import { join, win32 } from "node:path";
import { selectDataDirectory } from "../src/core/portable-paths.mjs";

const appData = "C:\\Users\\Luca\\AppData\\Roaming";
const localAppData = "C:\\Users\\Luca\\AppData\\Local";

test("modo pendrive guarda los datos junto a Bit.exe cuando hay portable.flag", () => {
  const result = selectDataDirectory({
    packaged: true,
    executablePath: "C:\\Users\\Luca\\AppData\\Local\\Bit\\Bit.exe",
    localAppData,
    appData,
    hasPortableFlag: true,
  });
  assert.equal(result.portable, true);
  assert.equal(result.directory, win32.join(localAppData, "Bit", "data"));
});

test("modo pendrive activa data para un ejecutable fuera de LOCALAPPDATA", () => {
  const result = selectDataDirectory({
    packaged: true,
    executablePath: "E:\\Bit\\Bit.exe",
    localAppData,
    appData,
    hasPortableFlag: false,
  });
  assert.equal(result.portable, true);
  assert.equal(result.directory, win32.join("E:\\", "Bit", "data"));
});

test("en desarrollo y dentro de LOCALAPPDATA se conserva el perfil previo", () => {
  for (const [packaged, executablePath] of [
    [false, "E:\\Bit\\Bit.exe"],
    [true, "C:\\Users\\Luca\\AppData\\Local\\Bit\\Bit.exe"],
  ]) {
    const result = selectDataDirectory({ packaged, executablePath, localAppData, appData, hasPortableFlag: false });
    assert.equal(result.portable, false);
    assert.equal(result.directory, join(appData, "Bit Preview"));
  }
});
