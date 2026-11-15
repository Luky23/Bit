export const DISPLAY_ROLES = ['main', 'project', 'info', 'hologram', 'none'];

export function resolveDisplayRoles(displays, preferences = new Map(), primaryDisplayId) {
  const sorted = [...displays].sort((a,b) => a.bounds.x-b.bounds.x || a.bounds.y-b.bounds.y);
  const primaryIndex = sorted.findIndex(display => display.id === primaryDisplayId);
  const resolvedPrimaryId = primaryIndex < 0 ? sorted[0]?.id : primaryDisplayId;
  const secondaryDisplays = sorted.filter(display => display.id !== resolvedPrimaryId);
  const defaults = sorted.length === 1
    ? ['main']
    : sorted.length === 2
      ? sorted.map((display, index) => index === (primaryIndex < 0 ? 0 : primaryIndex) ? 'main' : 'project')
      : sorted.map(display => display.id === resolvedPrimaryId
        ? 'main'
        : display.id === secondaryDisplays[0]?.id
          ? 'project'
          : display.id === secondaryDisplays[1]?.id
            ? 'info'
            : 'none');
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
