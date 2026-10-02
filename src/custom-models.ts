import type { CustomModelEntry, MotionMap, SpatialTapOverride } from "./models";
import { isSupportedModelLocation } from "./models";

export const CUSTOM_MODELS_FILENAME = "custom-models.jsonc";
export interface CustomModelsFileView { models: CustomModelEntry[]; error: string | null; path: string; }
const HEADER = `// CC GUI Live2D Pets 自定义模型（JSONC）。
// 远程模型填写 model.json 或 model3.json URL；本地模型请在设置中选择模型目录后保存。
// 可选字段：spatialTap / animationMap。`;
export function serializeCustomModels(models: readonly CustomModelEntry[]): string {
  return `${HEADER}\n${JSON.stringify({ models }, null, 2)}\n`;
}
export function normalizeCustomModel(raw: unknown): CustomModelEntry | null {
  if (typeof raw !== "object" || raw === null) return null;
  const record = raw as Record<string, unknown>;
  const id = typeof record.id === "string" ? record.id.trim() : "";
  const name = typeof record.name === "string" ? record.name.trim() : "";
  const modelUrl = typeof record.modelUrl === "string" ? record.modelUrl.trim() : "";
  const directoryGrantId = typeof record.directoryGrantId === "string" ? record.directoryGrantId.trim() : undefined;
  const directoryPath = typeof record.directoryPath === "string" ? record.directoryPath.trim() : undefined;
  if (!id || !/^[a-z][a-z0-9_-]*$/i.test(id) || !name) return null;
  if (!isSupportedModelLocation(modelUrl) && !(directoryGrantId && directoryPath)) return null;
  const entry: CustomModelEntry = { id, name, modelUrl };
  if (directoryGrantId && directoryPath) { entry.directoryGrantId = directoryGrantId; entry.directoryPath = directoryPath; }
  if (typeof record.spatialTap === "object" && record.spatialTap !== null) entry.spatialTap = record.spatialTap as SpatialTapOverride;
  if (typeof record.animationMap === "object" && record.animationMap !== null) entry.animationMap = record.animationMap as MotionMap;
  return entry;
}
export function parseCustomModels(text: string): CustomModelsFileView {
  try {
    const parsed = JSON.parse(stripJsonComments(text)) as { models?: unknown };
    if (parsed.models !== undefined && !Array.isArray(parsed.models)) return { models: [], error: 'JSONC 结构错误："models" 必须是数组', path: "" };
    const models: CustomModelEntry[] = [];
    const invalid: string[] = [];
    for (const raw of Array.isArray(parsed.models) ? parsed.models : []) {
      const model = normalizeCustomModel(raw);
      if (model) models.push(model);
      else invalid.push(typeof raw === "object" && raw !== null && "id" in raw && typeof raw.id === "string" ? raw.id : "?");
    }
    const seen = new Set<string>();
    const unique = models.filter((model) => !seen.has(model.id) && (seen.add(model.id), true));
    return { models: unique, error: invalid.length ? `已跳过 ${invalid.length} 个非法条目（id：${invalid.join("、")}）` : null, path: "" };
  } catch (error) {
    return { models: [], error: `JSONC 解析失败：${error instanceof Error ? error.message : String(error)}`, path: "" };
  }
}
export function stripJsonComments(text: string): string {
  let out = "";
  let inString = false;
  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i];
    const next = text[i + 1];
    if (inString) {
      out += ch;
      if (ch === "\\") out += next ?? "", i += 1;
      else if (ch === '"') inString = false;
    } else if (ch === '"') { inString = true; out += ch; }
    else if (ch === "/" && next === "/") { while (i < text.length && text[i] !== "\n") i += 1; }
    else if (ch === "/" && next === "*") { i += 2; while (i + 1 < text.length && !(text[i] === "*" && text[i + 1] === "/")) i += 1; i += 1; }
    else out += ch;
  }
  return out;
}
