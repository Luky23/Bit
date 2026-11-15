import { parse3DModel } from "./model-formats.mjs";
import { createModelViewer } from "./model-viewer.mjs";

window.bitModelViewer = Object.freeze({ parse3DModel, createModelViewer });
window.dispatchEvent(new Event("bit-model-viewer-ready"));
