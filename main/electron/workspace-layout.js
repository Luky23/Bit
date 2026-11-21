(() => {
  const apply = value => {
    const preset = typeof value === "string" ? value : value?.preset;
    if (!["home", "project", "project_3d", "document", "custom"].includes(preset)) return;
    document.body.dataset.workspaceLayout = preset;
    document.body.classList.toggle("workspace-layout-3d", preset === "project_3d");
    document.body.classList.toggle("workspace-layout-document", preset === "document");
  };
  window.bitRuntime?.onWorkspaceLayout?.(apply);
  void window.bitRuntime?.getConfig?.("workspaceLayout").then(result => apply(result?.value)).catch(() => {});

  const panelTargets = {
    core: ".conversation",
    conversation: ".conversation",
    context: "#context-panel",
    project: "#project-context",
    document: "#project-document",
    viewer3d: "#project-model",
    command: ".composer",
  };
  const applyUiState = state => {
    if (!state || typeof state !== "object") return;
    document.body.dataset.uiState = state.visualState || "idle";
    document.body.dataset.uiFocusedPanel = state.focusedPanel || "core";
    for (const [panel, selector] of Object.entries(panelTargets)) {
      const element = document.querySelector(selector);
      const open = state.panels?.[panel]?.open !== false;
      if (element) {
        element.dataset.uiPanel = panel;
        element.dataset.uiOpen = String(open);
        if (panel === "core" || panel === "conversation" || panel === "command") element.hidden = !open;
      }
    }
    if (state.layout) apply({ preset: state.workspace?.layout || document.body.dataset.workspaceLayout || "custom", layout: state.layout });
  };
  window.bitRuntime?.onUiState?.(applyUiState);
  void window.bitRuntime?.getUiState?.().then(applyUiState).catch(() => {});
})();
