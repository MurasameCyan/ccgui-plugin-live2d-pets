export interface PetDisplay { right: number; bottom: number; size: number; }
export const DEFAULT_DISPLAY: PetDisplay = { right: 24, bottom: 20, size: 160 };
const DISPLAY_MIN = 40;
const DISPLAY_MAX = 400;
const INSET_MAX = 4000;
function clamp(value: unknown, min: number, max: number): number {
  const n = typeof value === "number" ? value : Number(value);
  return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : min;
}
export function normalizeDisplay(display: Partial<PetDisplay>): PetDisplay {
  return {
    right: clamp(display.right ?? DEFAULT_DISPLAY.right, 0, INSET_MAX),
    bottom: clamp(display.bottom ?? DEFAULT_DISPLAY.bottom, 0, INSET_MAX),
    size: clamp(display.size ?? DEFAULT_DISPLAY.size, DISPLAY_MIN, DISPLAY_MAX),
  };
}
