const DEFAULT_EXCLUSIONS = ["Bit", "Bit Preview"];

export function createCapturePolicy(input = {}) {
  return {
    consent: input.consent === true,
    maxSide: Math.min(1920, Math.max(640, Number(input.maxSide) || 1280)),
    exclusions: [...new Set([...DEFAULT_EXCLUSIONS, ...(Array.isArray(input.exclusions) ? input.exclusions : [])])].slice(0, 100)
  };
}

export function canCapture(policy, windowTitle = "") {
  return policy?.consent === true && !policy.exclusions.some((value) => windowTitle.toLowerCase().includes(String(value).toLowerCase()));
}

export function resizeDimensions(width, height, maxSide = 1280) {
  const side = Math.max(width, height);
  if (!Number.isFinite(side) || side <= maxSide) return { width, height };
  const ratio = maxSide / side;
  return { width: Math.round(width * ratio), height: Math.round(height * ratio) };
}

export function auditCapture({ tool = "screen.capture", width, height, hash }) {
  return { tool, width, height, hash, content: undefined };
}
