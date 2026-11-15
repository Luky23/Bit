import test from "node:test";
import assert from "node:assert/strict";
import {
  DEFAULT_AUTONOMOUS_CATEGORIES,
  evaluatePermission,
  normalizePermissionGrants,
} from "../src/core/permission-policy.mjs";

test("permisos: una petición directa de bajo riesgo se ejecuta sin confirmación", () => {
  for (const category of ["app.open", "browser.open", "music.play", "web.search", "file.read"]) {
    const result = evaluatePermission({
      category,
      directUser: true,
      scopeAuthorized: true,
      reversible: true,
      modifiesState: category !== "web.search" && category !== "file.read",
    }, { permissionAutoCategories: DEFAULT_AUTONOMOUS_CATEGORIES, autonomyLevel: "balanced" });
    assert.equal(result.decision, "allow", category);
    assert.equal(result.risk, "low", category);
  }
});

test("permisos: una sugerencia del modelo no obtiene permiso de bajo riesgo por sí sola", () => {
  const result = evaluatePermission({
    category: "app.open",
    directUser: false,
    scopeAuthorized: true,
    modifiesState: true,
  });
  assert.equal(result.decision, "prompt");
});

test("permisos: contenido externo nunca autoriza una acción que modifica recursos", () => {
  const result = evaluatePermission({
    category: "workspace.write",
    directUser: true,
    externalContent: true,
    scopeAuthorized: true,
    reversible: true,
    modifiesState: true,
    scope: "workspace:Demo\\readme.md",
  });
  assert.equal(result.decision, "deny");
});

test("permisos: riesgo medio automático exige instrucción directa, recurso local y reversibilidad", () => {
  const request = {
    category: "workspace.write",
    directUser: true,
    scopeAuthorized: true,
    reversible: true,
    modifiesState: true,
    scope: "workspace:Demo\\readme.md",
  };
  assert.equal(evaluatePermission(request, { autonomyLevel: "balanced" }).decision, "allow");
  assert.equal(evaluatePermission({ ...request, reversible: false }, { autonomyLevel: "balanced" }).decision, "prompt");
  assert.equal(evaluatePermission({ ...request, scopeAuthorized: false }, { autonomyLevel: "balanced" }).decision, "prompt");
  assert.equal(evaluatePermission(request, { autonomyLevel: "conservative" }).decision, "prompt");
});

test("permisos: riesgo alto siempre pide confirmación y no se puede recordar", () => {
  const result = evaluatePermission({
    category: "file.delete",
    directUser: true,
    scopeAuthorized: true,
    reversible: true,
    modifiesState: true,
    scope: "C:\\Users\\Luca\\Documents",
  }, {
    autonomyLevel: "autonomous",
    permissionAutoCategories: ["file.delete"],
    permissionGrants: [{ category: "file.delete", scope: "C:\\Users\\Luca\\Documents" }],
  });
  assert.equal(result.decision, "prompt");
  assert.equal(result.risk, "high");
  assert.equal(result.rememberable, false);
});

test("permisos: un permiso recordado es exacto y solo cubre categorías reversibles", () => {
  const grants = [{ category: "workspace.write", scope: "workspace:Demo\\readme.md" }];
  const request = {
    category: "workspace.write",
    directUser: false,
    scopeAuthorized: true,
    reversible: true,
    modifiesState: true,
    scope: "workspace:Demo\\readme.md",
  };
  assert.equal(evaluatePermission(request, { autonomyLevel: "balanced", permissionGrants: grants }).decision, "prompt");
  assert.equal(evaluatePermission(request, { autonomyLevel: "autonomous", permissionGrants: grants }).decision, "allow");
  assert.equal(evaluatePermission({ ...request, scope: "workspace:Demo\\secret.md" }, {
    autonomyLevel: "autonomous",
    permissionGrants: grants,
  }).decision, "prompt");
});

test("permisos: revocar un permiso recordado impide reutilizarlo", () => {
  const request = {
    category: "workspace.write",
    directUser: false,
    scopeAuthorized: true,
    reversible: true,
    modifiesState: true,
    scope: "workspace:Demo\\readme.md",
  };
  const grants = [{ category: request.category, scope: request.scope }];
  assert.equal(evaluatePermission(request, {
    autonomyLevel: "autonomous",
    permissionGrants: grants,
  }).decision, "allow");

  const revoked = grants.filter(grant =>
    grant.category !== request.category || grant.scope !== request.scope);
  assert.equal(evaluatePermission(request, {
    autonomyLevel: "autonomous",
    permissionGrants: revoked,
  }).decision, "prompt");
});

test("permisos: valida y limita los permisos persistentes a recursos exactos", () => {
  const valid = normalizePermissionGrants([
    { category: "memory.write", scope: "vault:C:\\Users\\Luca\\Vault" },
  ]);
  assert.equal(valid.ok, true);
  assert.equal(normalizePermissionGrants([{ category: "file.delete", scope: "C:\\Users\\Luca" }]).ok, false);
  assert.equal(normalizePermissionGrants([{ category: "workspace.write", scope: "workspace:*" }]).ok, false);
  assert.equal(normalizePermissionGrants([{ category: "workspace.write", scope: "workspace:Demo", extra: true }]).ok, false);
});
