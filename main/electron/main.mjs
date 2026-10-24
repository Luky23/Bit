import { app, BrowserWindow, session } from "electron";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const here = fileURLToPath(new URL(".", import.meta.url));
const previewData = join(app.getPath("appData"), "Bit Preview");
app.setPath("userData", previewData);
app.setAppUserModelId("com.bit.assistant.preview");
app.commandLine.appendSwitch("disable-spell-checking");

function isAllowedUrl(url) {
  try {
    const parsed = new URL(url);
    return parsed.protocol === "file:" || parsed.protocol === "data:" || ["127.0.0.1", "localhost", "::1"].includes(parsed.hostname);
  } catch { return false; }
}

function createWindow() {
  const window = new BrowserWindow({
    width: 980,
    height: 720,
    minWidth: 760,
    minHeight: 520,
    show: false,
    backgroundColor: "#07131b",
    webPreferences: {
      preload: join(here, "preload.mjs"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      spellcheck: false
    }
  });
  window.once("ready-to-show", () => window.show());
  window.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
  window.loadFile(join(here, "index.html"));
}

app.whenReady().then(() => {
  session.defaultSession.webRequest.onBeforeRequest({ urls: ["*://*/*"] }, (details, callback) => callback({ cancel: !isAllowedUrl(details.url) }));
  createWindow();
  app.on("activate", () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });
});

app.on("window-all-closed", () => { if (process.platform !== "darwin") app.quit(); });
