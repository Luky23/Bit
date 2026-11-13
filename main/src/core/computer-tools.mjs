/**
 * Registro de herramientas Computer Use para el LLM
 * Herramientas de visión (captura pantalla) y ejecución (abrir apps)
 */

const SYSTEM_VISION_MODEL = "llava"; // Modelo visual por defecto

/**
 * Tool: system.captureScreen
 * Captura la pantalla y la analiza con un modelo visual local
 */
export const systemCaptureScreenTool = {
  name: "system.captureScreen",
  description: "Captura la pantalla del usuario y la analiza con un modelo visual local (llava/qwen2.5-vl). Úsala cuando necesites ver qué hay en la pantalla del usuario: qué aplicaciones están abiertas, qué texto hay visible, en qué ventana está trabajando, etc. El sistema captura la pantalla en memoria y la envía a un modelo visual local.",
  category: "screen",
  readOnly: true,
  lightweight: false, // Requiere captura + inferencia visual
  parameters: {
    type: "object",
    properties: {
      prompt: { type: "string", description: "Pregunta o instrucción para el modelo visual (ej: '¿Qué aplicación está en primer plano?', 'Lee el texto visible en la ventana activa', 'Describe lo que ves en pantalla')" },
      visionModel: { type: "string", description: "Modelo visual a usar (por defecto: llava)", default: "llava" },
      maxSide: { type: "integer", minimum: 640, maximum: 1920, default: 1280, description: "Resolución máxima de captura (lado mayor)" }
    },
    required: ["prompt"],
    additionalProperties: false
  },
  handler: async ({ prompt, visionModel = SYSTEM_VISION_MODEL, maxSide = 1280 }) => {
    // La ejecución real ocurre vía IPC bit:system-capture-screen
    throw new Error("Esta herramienta debe ejecutarse vía IPC bit:system-capture-screen");
  }
};

/**
 * Tool: system.openApp
 * Abre aplicaciones, archivos, URLs con confirmación del usuario
 */
export const systemOpenAppTool = {
  name: "system.openApp",
  description: "Abre aplicaciones nativas, archivos, URLs o protocolos del sistema. Requiere confirmación explícita del usuario mediante diálogo nativo. Úsala cuando el usuario pida abrir algo: programas (calc.exe, notepad.exe, code.exe), URLs (https://...), archivos (.txt, .pdf, .md), o protocolos Windows (ms-settings:, ms-photos:). El sistema validará el target contra una whitelist y pedirá aprobación antes de ejecutar.",
  category: "system",
  readOnly: false,
  lightweight: false, // Requiere confirmación nativa + ejecución
  parameters: {
    type: "object",
    properties: {
      target: { type: "string", description: "Comando, app, URL, archivo o protocolo a abrir (ej: 'notepad.exe', 'https://github.com', 'calc.exe', 'C:\\Users\\user\\documento.pdf', 'ms-settings:')" },
      args: { type: "string", description: "Argumentos adicionales para ejecutables (opcional)", default: "" }
    },
    required: ["target"],
    additionalProperties: false
  },
  handler: async ({ target, args = "" }) => {
    // La ejecución real ocurre vía IPC bit:system-open-app
    throw new Error("Esta herramienta debe ejecutarse vía IPC bit:system-open-app");
  }
};

/**
 * Exporta todas las herramientas de Computer Use
 */
export const COMPUTER_TOOLS = [
  systemCaptureScreenTool,
  systemOpenAppTool
];

/**
 * Obtiene herramientas de computer use filtradas por ruta
 */
export function getComputerToolsForRoute(route) {
  return COMPUTER_TOOLS.filter((tool) => {
    if (route === "vision") return tool.category === "screen" || tool.readOnly === true;
    if (route === "fast") return tool.lightweight === true || tool.readOnly === true;
    return tool.category === "system" || tool.readOnly === true;
  });
}