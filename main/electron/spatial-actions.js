(() => {
  const prompt = document.getElementById("prompt");
  const form = document.getElementById("chat-form");
  if (!prompt || !form) return;
  const chat = document.getElementById("chat");
  const greeting = document.getElementById("spatial-greeting");
  const projectName = document.getElementById("project-name");
  const projectLine = document.getElementById("spatial-project-line");
  const updateGreeting = () => {
    const hour = new Date().getHours();
    const salutation = hour < 12 ? "Buenos días" : hour < 20 ? "Buenas tardes" : "Buenas noches";
    if (greeting) greeting.textContent = `${salutation}, soy BIT.`;
  };
  updateGreeting();
  setInterval(updateGreeting, 60_000);
  const updateProjectLine = () => {
    if (!projectLine || !projectName) return;
    const name = projectName.textContent.trim();
    const available = name.length > 0 && name !== "Sin proyecto";
    projectLine.hidden = !available;
    projectLine.textContent = available ? `Trabajando en el proyecto ${name}.` : "";
  };
  if (projectName) {
    new MutationObserver(updateProjectLine).observe(projectName, { childList: true, characterData: true, subtree: true });
    updateProjectLine();
  }
  const updateConversation = () => {
    const hasConversation = Boolean(chat?.querySelector(".message.user, .message.assistant:not(#welcome)"));
    document.body.classList.toggle("spatial-conversation-active", hasConversation);
  };
  if (chat) {
    new MutationObserver(updateConversation).observe(chat, { childList: true });
    updateConversation();
  }
  const miniCore = document.getElementById("orb-mini-canvas");
  if (miniCore && typeof window.startBitCore === "function") {
    window.startBitCore(miniCore, () => ({ state: "idle" }));
  }
  for (const button of document.querySelectorAll(".spatial-actions [data-spatial-command]")) {
    button.addEventListener("click", () => {
      prompt.value = button.dataset.spatialCommand || "";
      prompt.focus();
      if (document.body.classList.contains("project-active")) form.requestSubmit();
    });
  }
})();
