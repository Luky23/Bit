import { opendir } from "node:fs/promises";
import { join } from "node:path";
import { ObsidianVault } from "./vault.mjs";

// Lectura acotada: no indexa la bóveda ni mantiene copias de datos personales.
export async function readConversationMemory(vaultPath, audit) {
  if (!vaultPath) return "";
  const vault = new ObsidianVault(vaultPath);
  await audit({ action: "memory.recall", status: "started" });
  let content = "";
  let notes = 0;
  try {
    const candidates = [];
    const directory = await opendir(join(vaultPath, "Bit", "Conversaciones"));
    let scanned = 0;
    for await (const entry of directory) {
      if (++scanned > 256) break;
      if (entry.isFile() && !entry.name.startsWith(".") && entry.name.endsWith(".md")) candidates.push(entry.name);
    }
    for (const name of candidates.sort().reverse().slice(0, 4)) {
      try {
        const note = await vault.readNote(join("Bit", "Conversaciones", name), { maxBytes: 16_384 });
        content += `${JSON.stringify(name)}:\n${note.content}\n\n`;
        notes++;
        if (content.length >= 6000) break;
      } catch {
        // Una nota inaccesible, demasiado grande o insegura no interrumpe el chat.
      }
    }
    await audit({ action: "memory.recall", status: "completed", notes });
    return content.slice(0, 6000);
  } catch (error) {
    await audit({ action: "memory.recall", status: error?.code === "ENOENT" ? "empty" : "failed" });
    return "";
  }
}
