export const DISPLAY_ROLES = ['main', 'project', 'info', 'none'];

export function resolveDisplayRoles(displays, preferences = new Map()) {
  const sorted = [...displays].sort((a,b) => a.bounds.x-b.bounds.x || a.bounds.y-b.bounds.y);
  const defaults = sorted.length === 1 ? ['main'] : sorted.length === 2 ? ['main','project'] : ['project','main','info'];
  const roles = new Map(sorted.map((d,i) => [d.id, preferences.get(d.id) ?? defaults[i] ?? 'none']));
  const used = new Set();
  // Explicit choices take priority over automatic assignments.
  for(const d of [...sorted.filter(d=>preferences.has(d.id)), ...sorted.filter(d=>!preferences.has(d.id))]) {
    const role=roles.get(d.id);
    if(role !== 'none' && used.has(role)) roles.set(d.id,'none');
    else used.add(role);
  }
  if(sorted.length && ![...roles.values()].includes('main')) {
    roles.set((sorted.find(d=>!preferences.has(d.id)) ?? sorted[0]).id,'main');
  }
  return roles;
}
