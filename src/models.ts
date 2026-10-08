export interface BuiltinPreset {
  id: string;
  name: string;
  author: string;
  modelUrl: string;
  license: { type: string; url: string };
  cubism: number;
  status: string;
  spatialTap?: SpatialTapOverride;
  animationMap?: MotionMap;
}

export type AnimationSlot = "idle" | "thinking" | "error" | "done" | "waiting" | "head" | "leg" | "arm" | "body";
export const ANIMATION_SLOTS: readonly AnimationSlot[] = ["idle", "thinking", "error", "done", "waiting", "head", "leg", "arm", "body"];
export type MotionMap = Partial<Record<AnimationSlot, string[]>>;
/** 默认候选链。
 *  状态槽位（thinking/error/done/waiting）**不得**以 `Idle` 兜底：状态动作全部失败时
 *  应当什么都不播、保持当前姿势，而不是静默降级成一个 idle 动作——那和真正的 idle
 *  段肉眼无法区分，会把「这个模型没有该状态的动作」伪装成「功能正常」。
 *  互动槽位保留 `TapBody` 兜底：那是同类动作间的替代，不会伪装成别的状态。 */
export const DEFAULT_MOTION_MAP: MotionMap = {
  idle: ["Idle"], thinking: ["Thinking", "Working"], error: ["Failed", "Sad"],
  done: ["Jumping", "Done"], waiting: ["Waiting"], head: ["TapHead", "TapBody"],
  leg: ["TapLeg", "TapBody"], arm: ["TapArm", "TapBody"], body: ["TapBody"],
};

export interface SpatialTapConfig {
  headMaxNy: number; legMinNy: number; armMinNy: number; headMinNx: number; headMaxNx: number;
  bodyMinNx: number; bodyMaxNx: number; armLeftMinNx: number; armRightMaxNx: number;
}
export type SpatialTapOverride = Partial<SpatialTapConfig> & { armLeftMaxNx?: number; armRightMinNx?: number };
export const DEFAULT_SPATIAL_TAP: SpatialTapConfig = {
  headMaxNy: 0.32, legMinNy: 0.58, armMinNy: 0.28, headMinNx: 0, headMaxNx: 1,
  bodyMinNx: 0.38, bodyMaxNx: 0.62, armLeftMinNx: 0, armRightMaxNx: 1,
};

export function isRemoteModelUrl(value: string): boolean { return /^https?:\/\//i.test(value.trim()); }
export function isLocalModelPath(value: string): boolean {
  const v = value.trim();
  return /^[a-zA-Z]:[\\/]/.test(v) || /^\\\\/.test(v) || /^\//.test(v);
}
export function isSupportedModelLocation(value: string): boolean { return isRemoteModelUrl(value) || isLocalModelPath(value); }

/** 判断模型来源是否指向 Cubism 2.1 的 model.json 配置。查询串和片段不影响格式判断。 */
export function isLegacyModelLocation(value: string): boolean {
  const path = value.trim().split(/[?#]/, 1)[0] ?? "";
  return /(?:^|[\\/])(?:model|[^\\/]+\.model)\.json$/i.test(path);
}

export interface CustomModelEntry {
  id: string;
  name: string;
  /** Remote .model.json or .model3.json URL, or the original local path for migration/display. */
  modelUrl: string;
  /** Directory grant used for local models under the CC GUI asset bridge. */
  directoryGrantId?: string;
  /** Model entry path relative to directoryGrantId. */
  directoryPath?: string;
  spatialTap?: SpatialTapOverride;
  animationMap?: MotionMap;
}

function clamp01(value: unknown, fallback: number): number {
  const n = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(1, Math.max(0, n));
}
export function mergeSpatialTap(override?: SpatialTapOverride | null): SpatialTapConfig {
  const o = override ?? {};
  return {
    headMaxNy: clamp01(o.headMaxNy, DEFAULT_SPATIAL_TAP.headMaxNy),
    legMinNy: clamp01(o.legMinNy, DEFAULT_SPATIAL_TAP.legMinNy),
    armMinNy: clamp01(o.armMinNy, DEFAULT_SPATIAL_TAP.armMinNy),
    headMinNx: clamp01(o.headMinNx, DEFAULT_SPATIAL_TAP.headMinNx),
    headMaxNx: clamp01(o.headMaxNx, DEFAULT_SPATIAL_TAP.headMaxNx),
    bodyMinNx: clamp01(o.bodyMinNx ?? o.armLeftMaxNx, DEFAULT_SPATIAL_TAP.bodyMinNx),
    bodyMaxNx: clamp01(o.bodyMaxNx ?? o.armRightMinNx, DEFAULT_SPATIAL_TAP.bodyMaxNx),
    armLeftMinNx: clamp01(o.armLeftMinNx, DEFAULT_SPATIAL_TAP.armLeftMinNx),
    armRightMaxNx: clamp01(o.armRightMaxNx, DEFAULT_SPATIAL_TAP.armRightMaxNx),
  };
}
