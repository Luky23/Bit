export function stripThinkTags(text) {
  if (typeof text !== "string") return "";
  return text.replace(/<think>[\s\S]*?<\/think>/gi, "").trim();
}

export function normalizeModelResponse(payload) {
  const response = payload && typeof payload === "object" ? payload : {};
  const reasoning = typeof response.thinking === "string" ? response.thinking :
    typeof response.reasoning === "string" ? response.reasoning : "";
  const raw = typeof response.response === "string" ? response.response :
    typeof response.message?.content === "string" ? response.message.content : "";
  const visible = stripThinkTags(raw);
  return { text: visible, reasoning, toolCalls: Array.isArray(response.message?.tool_calls) ? response.message.tool_calls : [] };
}
