export interface PetDisplay {
  right: number;
  bottom: number;
  size: number;
  debugPosition?: { left: number; top: number };
}
export const DEFAULT_DISPLAY: PetDisplay = { right: 24, bottom: 20, size: 160 };
const DISPLAY_MIN = 40;
const DISPLAY_MAX = 400;
const INSET_MAX = 4000;
function clamp(value: unknown, min: number, max: number, fallback = min): number {
  const n = typeof value === "number" ? value : Number(value);
  return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : fallback;
}
export function normalizeDisplay(display: Partial<PetDisplay>): PetDisplay {
  const normalized: PetDisplay = {
    right: clamp(display.right ?? DEFAULT_DISPLAY.right, -INSET_MAX, INSET_MAX, 0),
    bottom: clamp(display.bottom ?? DEFAULT_DISPLAY.bottom, -INSET_MAX, INSET_MAX, 0),
    size: clamp(display.size ?? DEFAULT_DISPLAY.size, DISPLAY_MIN, DISPLAY_MAX),
  };
  const debug = display.debugPosition;
  if (debug && Number.isFinite(debug.left) && Number.isFinite(debug.top)) {
    normalized.debugPosition = {
      left: clamp(debug.left, 0, INSET_MAX),
      top: clamp(debug.top, 0, INSET_MAX),
    };
  }
  return normalized;
}
