import test from "node:test";
import assert from "node:assert/strict";
import { isWorkspaceContinuationReply, mayBeWorkspaceNavigationRequest, resolveWorkspaceNavigationIntent } from "../src/projects/navigation.mjs";

test("reconoce empecemos y recupera el proyecto activo", () => {
  assert.deepEqual(resolveWorkspaceNavigationIntent("BIT, empecemos un proyecto llamado FlipDock"), {
    type: "createProject",
    project: "FlipDock",
  });
  assert.deepEqual(resolveWorkspaceNavigationIntent("BIT, abrí mi proyecto", {
    activeProject: "FlipDock",
    projects: ["FlipDock"],
  }), { type: "openProject", project: "FlipDock" });
});

const projects = ["FlipDock", "Orbit"];
const lastSession = { project: "FlipDock", lastTask: "Ajustar el panel de carga" };

test("navegación reconoce apertura, inicio y lista sin depender del modelo", () => {
  assert.deepEqual(resolveWorkspaceNavigationIntent("BIT, abrí el proyecto FlipDock", { projects }), {
    type: "openProject",
    project: "FlipDock",
  });
  assert.deepEqual(resolveWorkspaceNavigationIntent("BIT, volvé al inicio"), { type: "showHome" });
  assert.equal(mayBeWorkspaceNavigationRequest("Cerrá la vista del proyecto"), true);
  assert.deepEqual(resolveWorkspaceNavigationIntent("Cerrá la vista del proyecto"), { type: "showHome" });
  assert.deepEqual(resolveWorkspaceNavigationIntent("Mostrame mis proyectos", { projects }), { type: "listProjects" });
  assert.deepEqual(resolveWorkspaceNavigationIntent("BIT, mostrámela pantalla principal"), { type: "showHome" });
  assert.equal(mayBeWorkspaceNavigationRequest("Mostramela pantalla principal"), true);
  assert.deepEqual(resolveWorkspaceNavigationIntent("BIT, mostrá el núcleo"), { type: "showHome" });
  assert.deepEqual(resolveWorkspaceNavigationIntent("Salí del proyecto"), { type: "showHome" });
  assert.deepEqual(resolveWorkspaceNavigationIntent("Cerrá este proyecto"), { type: "closeProject" });
  assert.deepEqual(resolveWorkspaceNavigationIntent("Cerrá el visor"), { type: "closeViewer" });
  assert.deepEqual(resolveWorkspaceNavigationIntent("Volvé al proyecto anterior"), { type: "back" });
  assert.deepEqual(resolveWorkspaceNavigationIntent("Mostrame el visor 3D"), { type: "showViewer" });
  assert.deepEqual(resolveWorkspaceNavigationIntent("Abrí otro proyecto sin cerrar este", { projects }), { type: "chooseProject", projects });
});

test("cambia directamente entre proyectos conocidos sin cerrar el anterior", () => {
  assert.deepEqual(resolveWorkspaceNavigationIntent("Cambiá a Orbit", { projects }), {
    type: "openProject",
    project: "Orbit",
  });
  assert.deepEqual(resolveWorkspaceNavigationIntent("Abrí FlipDock", { projects }), {
    type: "openProject",
    project: "FlipDock",
  });
});

test("crear exige una instrucción directa y conserva el nombre escrito", () => {
  assert.deepEqual(resolveWorkspaceNavigationIntent("quiero empezar un proyecto"), { type: "startProject" });
  assert.deepEqual(resolveWorkspaceNavigationIntent("Orbit", { pendingNewProject: true }), {
    type: "createProject",
    project: "Orbit",
  });
  assert.deepEqual(resolveWorkspaceNavigationIntent("BIT, quiero empezar un proyecto nuevo llamado Orbit"), {
    type: "createProject",
    project: "Orbit",
  });
  assert.deepEqual(resolveWorkspaceNavigationIntent("quiero empezar un nuevo proyecto que se llame FlipDock"), {
    type: "createProject",
    project: "FlipDock",
  });
  assert.equal(resolveWorkspaceNavigationIntent("Me gustaría que algún día hubiera un proyecto Orbit"), null);
});

test("continuar ofrece la sesión guardada y una respuesta afirmativa la reanuda", () => {
  assert.deepEqual(resolveWorkspaceNavigationIntent("Quiero seguir trabajando", { projects, lastSession }), {
    type: "suggestContinuation",
    project: "FlipDock",
  });
  assert.deepEqual(resolveWorkspaceNavigationIntent("continuemos", { projects, pendingProject: "FlipDock" }), {
    type: "resumeProject",
    project: "FlipDock",
  });
  assert.equal(isWorkspaceContinuationReply("sí, continuemos"), true);
  assert.deepEqual(resolveWorkspaceNavigationIntent("sigamos con lo que estaba haciendo ayer", { projects, lastSession }), {
    type: "resumeProject",
    project: "FlipDock",
  });
  assert.equal(mayBeWorkspaceNavigationRequest("sigamos con lo que estaba haciendo ayer"), true);
});

test("un nombre no registrado no se sustituye por otro proyecto disponible", () => {
  assert.deepEqual(resolveWorkspaceNavigationIntent("Abrí el proyecto NoExiste", { projects }), {
    type: "openProject",
    project: "NoExiste",
  });
  assert.deepEqual(resolveWorkspaceNavigationIntent("Quiero seguir trabajando", { projects }), {
    type: "chooseProject",
    projects,
  });
});

test("abrir archivo devuelve la ruta solicitada para validarla contra el proyecto", () => {
  assert.equal(mayBeWorkspaceNavigationRequest("BIT, abrí el archivo docs/guía.md"), true);
  assert.deepEqual(resolveWorkspaceNavigationIntent("BIT, abrí el archivo docs/guía.md"), {
    type: "openProjectFile",
    path: "docs/guía.md",
  });
});
