export function dipToPhysical(rect, scale = 1) {
  return { x: Math.round(rect.x * scale), y: Math.round(rect.y * scale), width: Math.round(rect.width * scale), height: Math.round(rect.height * scale) };
}

export function physicalToDip(rect, scale = 1) {
  if (!Number.isFinite(scale) || scale <= 0) throw new Error("escala DPI inválida");
  return { x: Math.round(rect.x / scale), y: Math.round(rect.y / scale), width: Math.round(rect.width / scale), height: Math.round(rect.height / scale) };
}

export function mapAcrossDisplay(rect, source, target) {
  const physical = dipToPhysical(rect, source.scale);
  return physicalToDip({ x: physical.x - target.x + source.x, y: physical.y - target.y + source.y, width: physical.width, height: physical.height }, target.scale);
}
