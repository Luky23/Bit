export function validateOcrBoxes(boxes, image) {
  if (!Array.isArray(boxes)) return [];
  return boxes.filter((box) => typeof box?.text === "string" && box.text.length <= 500 && Number.isFinite(box.x) && Number.isFinite(box.y) && Number.isFinite(box.width) && Number.isFinite(box.height) && box.width >= 0 && box.height >= 0 && box.x >= 0 && box.y >= 0 && box.x + box.width <= image.width && box.y + box.height <= image.height).map((box) => ({ text: box.text, x: Math.round(box.x), y: Math.round(box.y), width: Math.round(box.width), height: Math.round(box.height) }));
}
