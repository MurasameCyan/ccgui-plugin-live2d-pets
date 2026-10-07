import {
  DEFAULT_SPATIAL_TAP,
  isRemoteModelUrl,
  mergeSpatialTap,
  type BuiltinPreset,
  type CustomModelEntry,
  type MotionMap,
  type SpatialTapConfig,
} from "./models";

export const BUILTIN_PRESETS: readonly BuiltinPreset[] = [
  { id: "hiyori", name: "Hiyori（百瀬ひより）", author: "Live2D Inc.", modelUrl: "https://cdn.jsdelivr.net/gh/Live2D/CubismWebSamples@develop/Samples/Resources/Hiyori/Hiyori.model3.json", license: { type: "Live2D 示例模型条款", url: "https://www.live2d.com/eula/live2d-sample-model-terms_cn.html" }, cubism: 4, status: "annotated", spatialTap: { headMaxNy: 0.30, legMinNy: 0.57, armMinNy: 0.28, headMinNx: 0.32, headMaxNx: 0.68, bodyMinNx: 0.36, bodyMaxNx: 0.64, armLeftMinNx: 0.18, armRightMaxNx: 0.82 } },
  { id: "haru", name: "Haru（春）", author: "Live2D Inc.", modelUrl: "https://cdn.jsdelivr.net/gh/Live2D/CubismWebSamples@develop/Samples/Resources/Haru/Haru.model3.json", license: { type: "Live2D 示例模型条款", url: "https://www.live2d.com/eula/live2d-sample-model-terms_cn.html" }, cubism: 4, status: "annotated" },
  { id: "mao", name: "Mao", author: "Live2D Inc.", modelUrl: "https://cdn.jsdelivr.net/gh/Live2D/CubismWebSamples@develop/Samples/Resources/Mao/Mao.model3.json", license: { type: "Live2D 示例模型条款", url: "https://www.live2d.com/eula/live2d-sample-model-terms_cn.html" }, cubism: 4, status: "annotated" },
  { id: "mark", name: "Mark", author: "Live2D Inc.", modelUrl: "https://cdn.jsdelivr.net/gh/Live2D/CubismWebSamples@develop/Samples/Resources/Mark/Mark.model3.json", license: { type: "Live2D 示例模型条款", url: "https://www.live2d.com/eula/live2d-sample-model-terms_cn.html" }, cubism: 4, status: "annotated" },
  { id: "natori", name: "Natori", author: "Live2D Inc.", modelUrl: "https://cdn.jsdelivr.net/gh/Live2D/CubismWebSamples@develop/Samples/Resources/Natori/Natori.model3.json", license: { type: "Live2D 示例模型条款", url: "https://www.live2d.com/eula/live2d-sample-model-terms_cn.html" }, cubism: 4, status: "annotated" },
];

export function listBuiltinPresets(): BuiltinPreset[] { return BUILTIN_PRESETS.map((preset) => ({ ...preset, license: { ...preset.license }, spatialTap: preset.spatialTap ? { ...preset.spatialTap } : undefined })); }
export function resolveSpatialTap(model: string, customModels: readonly CustomModelEntry[]): SpatialTapConfig {
  const custom = customModels.find((entry) => entry.id === model);
  if (custom?.spatialTap) return mergeSpatialTap(custom.spatialTap);
  return mergeSpatialTap(BUILTIN_PRESETS.find((preset) => preset.id === model)?.spatialTap);
}
export function resolveMotionMap(model: string, customModels: readonly CustomModelEntry[]): MotionMap {
  const custom = customModels.find((entry) => entry.id === model);
  const preset = BUILTIN_PRESETS.find((entry) => entry.id === model);
  // Overrides only. The client must be able to tell a configured slot from the
  // default ordered fallback chain, which it tries in order and never shuffles.
  return { ...(custom?.animationMap ?? preset?.animationMap ?? {}) };
}
export function resolveModelLocation(model: string, customModels: readonly CustomModelEntry[]): string | null {
  if (isRemoteModelUrl(model)) return model;
  const preset = BUILTIN_PRESETS.find((entry) => entry.id === model);
  if (preset) return preset.modelUrl;
  return customModels.find((entry) => entry.id === model)?.modelUrl ?? null;
}
export const DEFAULT_TAP = DEFAULT_SPATIAL_TAP;
