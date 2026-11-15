function normalizeText(value) {
  return String(value ?? "")
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLocaleLowerCase("es-AR")
    .replace(/[¿?¡!,.;:]/gu, " ")
    .replace(/\s+/gu, " ")
    .trim();
}

function cleanCapture(value) {
  return String(value ?? "").trim().replace(/^["']|["']$/gu, "").replace(/[.!?]+$/gu, "").trim();
}

function matchesAny(text, patterns) {
  return patterns.some(pattern => pattern.test(text));
}

function knownProject(project, projects) {
  const normalized = normalizeText(project);
  return projects.find(candidate => normalizeText(candidate) === normalized) || "";
}

function extractProject(text, projects) {
  const candidates = [...projects].sort((a, b) => b.length - a.length);
  return candidates.find(project => text.includes(normalizeText(project))) || "";
}

export function resolveWorkspaceNavigationIntent(message, {
  projects = [],
  lastSession = null,
  activeProject = "",
  pendingProject = "",
} = {}) {
  const text = normalizeText(message);
  if (!text) return null;

  if (matchesAny(text, [
    /^(?:bit )?(?:volve al inicio|volves al inicio|mostrame la pantalla principal|mostra la pantalla principal|mostramela pantalla principal|mostra(?:me)? la principal|cerra la vista del proyecto|cerrar la vista del proyecto|volver al inicio|mostrar pantalla principal|inicio)$/u,
    /^(?:bit )?(?:volv[eé] a bit|volver a bit|mostrame bit)$/u,
  ])) return { type: "showHome" };

  if (matchesAny(text, [
    /^(?:bit )?(?:lista|listar|mostrame|mostrar|cuales son|que proyectos tengo|elegir otro)\s*(?:mis)? proyectos?$/u,
    /^(?:bit )?mis proyectos$/u,
  ])) return { type: "listProjects" };

  if (pendingProject) {
    const selectedProject = projects.find(project => normalizeText(project) === text);
    if (selectedProject) return { type: "openProject", project: selectedProject };
  }

  const createMatch = String(message).trim().match(
    /^(?:(?:bit)[,:\s]+)?(?:(?:por favor)[,\s]+)?(?:(?:quiero|necesito)\s+)?(?:empezar|empecemos|iniciar|iniciemos|crear|cre[aá]me|cre[aá])\s+(?:un\s+)?(?:nuevo\s+)?proyecto(?:\s+nuevo)?(?:\s+(?:llamado|denominado|de nombre|que\s+se\s+llame))?\s+(.+?)\s*[.!?]*$/iu,
  );
  if (createMatch) {
    const project = cleanCapture(createMatch[1]);
    if (project) return { type: "createProject", project };
  }

  const fileMatch = String(message).trim().match(
    /^(?:(?:bit)[,:\s]+)?(?:(?:por favor)[,\s]+)?(?:(?:quiero\s+)?(?:abrir|abre|abrime|abr[ií]))\s+(?:el\s+)?archivo\s+(.+?)\s*[.!?]*$/iu,
  );
  if (fileMatch) {
    const path = cleanCapture(fileMatch[1]);
    if (path) return { type: "openProjectFile", path };
  }

  const openMatch = String(message).trim().match(
    /^(?:(?:bit)[,:\s]+)?(?:(?:por favor)[,\s]+)?(?:(?:quiero\s+)?(?:abrir|abre|abrime|abr[ií]|activa|retoma))\s+(?:mi\s+|el\s+)?proyecto(?:\s+(.+?))?\s*[.!?]*$/iu,
  );
  if (openMatch) {
    const requested = cleanCapture(openMatch[1] || "");
    const project = knownProject(requested, projects) || extractProject(text, projects);
    return { type: "openProject", project: project || requested || knownProject(activeProject, projects) || activeProject };
  }

  if (pendingProject && isWorkspaceContinuationReply(text)) {
    return { type: "resumeProject", project: knownProject(pendingProject, projects) || pendingProject };
  }

  const resumeRequest = matchesAny(text, [
    /(?:sigamos|continuemos|retomemos|reanuda|retoma).*(?:ayer|anterior|ultima sesion|lo que estaba haciendo)/u,
    /(?:quiero )?(?:seguir|continuar) trabajando/u,
  ]);
  if (resumeRequest) {
    const savedProject = typeof lastSession?.project === "string" ? lastSession.project : "";
    const project = knownProject(savedProject, projects)
      || knownProject(activeProject, projects);
    if (project) {
      if (/(?:ayer|lo que estaba haciendo|ultima sesion|reanuda|retoma)/u.test(text)) {
        return { type: "resumeProject", project };
      }
      return { type: "suggestContinuation", project };
    }
    return { type: "chooseProject", projects: [...projects] };
  }

  return null;
}

export function isWorkspaceContinuationReply(message) {
  return matchesAny(normalizeText(message), [
    /^(?:si )?(?:dale|continuemos|continuar|retomemos|abrilo|abrila|vamos)$/u,
  ]);
}

export function mayBeWorkspaceNavigationRequest(message) {
  const text = normalizeText(message);
  return matchesAny(text, [
    /\b(?:lista|listar|mostrame|mostrar|que proyectos tengo|elegir otro)\b.*\bproyectos?\b/u,
    /\b(?:crear|crea|creame|empezar|iniciar)\b.*\bproyecto\b/u,
    /\b(?:abrir|abre|abrime|abri|activa|retoma)\b.*\b(?:proyecto|archivo)\b/u,
    /\b(?:inicio|pantalla principal|mostramela pantalla principal|la principal|sigamos|continuemos|continuar trabajando|seguir trabajando|retomar|reanudar|cerrar la vista|cerra la vista|volver a bit|volve al inicio)\b/u,
    /^(?:si|dale|vamos)$/u,
  ]);
}
