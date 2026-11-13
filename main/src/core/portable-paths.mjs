import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";

function isInside(parent, child) {
  const rel = relative(parent, child);
  return rel === "" || (rel !== ".." && !rel.startsWith(`..${sep}`) && !isAbsolute(rel));
}

/** Selects the writable data directory before Electron becomes ready. */
export function selectDataDirectory({ packaged, executablePath, localAppData, appData, hasPortableFlag }) {
  if (!isAbsolute(executablePath) || !isAbsolute(appData)) throw new Error("Rutas de inicio inválidas");
  const executableDir = dirname(resolve(executablePath));
  const outsideLocalAppData = !localAppData || !isAbsolute(localAppData)
    || !isInside(resolve(localAppData), executableDir);
  const portable = packaged === true && (hasPortableFlag === true || outsideLocalAppData);
  return {
    portable,
    directory: portable ? join(executableDir, "data") : join(appData, "Bit Preview"),
  };
}
