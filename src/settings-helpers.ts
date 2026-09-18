import {
  ANIMATION_SLOTS,
  DEFAULT_SPATIAL_TAP,
  type MotionMap,
  type SpatialTapOverride,
} from "./models";

export type SpatialTapDraft = Record<keyof typeof DEFAULT_SPATIAL_TAP, string>;

export const EMPTY_SPATIAL_DRAFT: SpatialTapDraft = {
  headMaxNy: "",
  legMinNy: "",
  armMinNy: "",
  headMinNx: "",
  headMaxNx: "",
  bodyMinNx: "",
  bodyMaxNx: "",
  armLeftMinNx: "",
  armRightMaxNx: "",
};

export const SPATIAL_FIELD_LABELS: readonly { key: keyof SpatialTapDraft; label: string; hint: string }[] = [
  { key: "headMaxNy", label: "头下沿", hint: String(DEFAULT_SPATIAL_TAP.headMaxNy) },
  { key: "legMinNy", label: "腿上沿", hint: String(DEFAULT_SPATIAL_TAP.legMinNy) },
  { key: "armMinNy", label: "手臂顶", hint: String(DEFAULT_SPATIAL_TAP.armMinNy) },
  { key: "headMinNx", label: "头左", hint: String(DEFAULT_SPATIAL_TAP.headMinNx) },
  { key: "headMaxNx", label: "头右", hint: String(DEFAULT_SPATIAL_TAP.headMaxNx) },
  { key: "bodyMinNx", label: "身左", hint: String(DEFAULT_SPATIAL_TAP.bodyMinNx) },
  { key: "bodyMaxNx", label: "身右", hint: String(DEFAULT_SPATIAL_TAP.bodyMaxNx) },
  { key: "armLeftMinNx", label: "左臂左", hint: String(DEFAULT_SPATIAL_TAP.armLeftMinNx) },
  { key: "armRightMaxNx", label: "右臂右", hint: String(DEFAULT_SPATIAL_TAP.armRightMaxNx) },
];

export function draftFromOverride(override?: SpatialTapOverride | null): SpatialTapDraft {
  return {
    headMaxNy: override?.headMaxNy == null ? "" : String(override.headMaxNy),
    legMinNy: override?.legMinNy == null ? "" : String(override.legMinNy),
    armMinNy: override?.armMinNy == null ? "" : String(override.armMinNy),
    headMinNx: override?.headMinNx == null ? "" : String(override.headMinNx),
    headMaxNx: override?.headMaxNx == null ? "" : String(override.headMaxNx),
    bodyMinNx: override?.bodyMinNx == null
      ? (override?.armLeftMaxNx == null ? "" : String(override.armLeftMaxNx))
      : String(override.bodyMinNx),
    bodyMaxNx: override?.bodyMaxNx == null
      ? (override?.armRightMinNx == null ? "" : String(override.armRightMinNx))
      : String(override.bodyMaxNx),
    armLeftMinNx: override?.armLeftMinNx == null ? "" : String(override.armLeftMinNx),
    armRightMaxNx: override?.armRightMaxNx == null ? "" : String(override.armRightMaxNx),
  };
}

export function overrideFromDraft(draft: SpatialTapDraft): SpatialTapOverride | undefined {
  const result: SpatialTapOverride = {};
  for (const { key } of SPATIAL_FIELD_LABELS) {
    const raw = draft[key].trim();
    if (!raw) continue;
    const value = Number(raw);
    if (Number.isFinite(value)) result[key] = Math.min(1, Math.max(0, value));
  }
  return Object.keys(result).length > 0 ? result : undefined;
}

export function motionMapFromDraft(draft: MotionMap): MotionMap | undefined {
  const result: MotionMap = {};
  for (const slot of ANIMATION_SLOTS) {
    const groups = (draft[slot] ?? []).filter((group) => group.trim().length > 0);
    if (groups.length > 0) result[slot] = groups;
  }
  return Object.keys(result).length > 0 ? result : undefined;
}

export function draftFromMotionMap(map?: MotionMap | null): MotionMap {
  const result: MotionMap = {};
  for (const slot of ANIMATION_SLOTS) result[slot] = [...(map?.[slot] ?? [])];
  return result;
}
