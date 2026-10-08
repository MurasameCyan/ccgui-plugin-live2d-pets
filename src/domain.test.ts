import { describe, expect, it } from "vitest";
import { parseCustomModels } from "./custom-models";
import { DEFAULT_MOTION_MAP, DEFAULT_SPATIAL_TAP, isSupportedModelLocation, mergeSpatialTap } from "./models";
import { BUILTIN_PRESETS, resolveModelLocation, resolveMotionMap } from "./models-host";
import { parsePersonas } from "./personas";
import { resolvePersonaCopy } from "./client/personas";


describe("Live2D model and persona data", () => {
  it("resolves curated and custom model locations", () => {
    expect(BUILTIN_PRESETS).toHaveLength(5);
    expect(resolveModelLocation("hiyori", [])).toContain("Hiyori.model3.json");
    expect(resolveModelLocation("custom", [{ id: "custom", name: "Custom", modelUrl: "https://example.test/model3.json" }])).toBe("https://example.test/model3.json");
    expect(resolveModelLocation("missing", [])).toBeNull();
  });

  it("clamps spatial tap overrides and reports only real motion overrides", () => {
    expect(mergeSpatialTap({ headMaxNy: 2, bodyMinNx: -1 })).toMatchObject({
      headMaxNy: 1,
      bodyMinNx: 0,
      bodyMaxNx: DEFAULT_SPATIAL_TAP.bodyMaxNx,
    });
    expect(resolveMotionMap("hiyori", [])).toEqual({});
    expect(resolveMotionMap("pet", [{ id: "pet", name: "Pet", modelUrl: "https://example.test/model3.json", animationMap: { body: ["Tap"] } }])).toEqual({ body: ["Tap"] });
  });

  it("never ends a state motion chain with the idle fallback", () => {
    // 状态动作全部失败时必须什么都不播（保持当前姿势）。若链尾是 Idle，失败就会
    // 静默降级成一个 idle 动作——与真正的 idle 段肉眼无法区分，把「模型缺这个状态
    // 的动作」伪装成「功能正常」。done 上就是这么漏掉的（Jumping/Done 都不存在）。
    for (const slot of ["thinking", "error", "done", "waiting"] as const) {
      const chain = DEFAULT_MOTION_MAP[slot] ?? [];
      expect(chain.length).toBeGreaterThan(0);
      expect(chain).not.toContain("Idle");
    }
    // idle 自己当然用 Idle；互动槽位的 TapBody 兜底是同类替代，保留。
    expect(DEFAULT_MOTION_MAP.idle).toEqual(["Idle"]);
    expect(DEFAULT_MOTION_MAP.head).toContain("TapBody");
  });

  it("parses JSONC custom personas and merges only overridden copy pools", () => {
    const view = parsePersonas(`{
      // user-defined persona
      "personas": [{ "id": "quiet", "name": "安静", "base": "kuudere", "copy": { "idle": ["在。"] } }]
    }`);
    expect(view.error).toBeNull();
    expect(resolvePersonaCopy("quiet", view.personas).idle).toEqual(["在。"]);
    expect(resolvePersonaCopy("quiet", view.personas).tapHead).toEqual(expect.arrayContaining(["…舒服。"]));
  });

  it("skips invalid custom model entries while retaining valid entries", () => {
    const view = parseCustomModels(JSON.stringify({ models: [
      { id: "ok", name: "OK", modelUrl: "https://example.test/model3.json" },
      { id: "bad", name: "", modelUrl: "relative/model3.json" },
    ] }));
    expect(view.models.map((model) => model.id)).toEqual(["ok"]);
  });

  it("accepts both Cubism 2.1 model.json and Cubism 3-5.3 model3.json model sources", () => {
    expect(isSupportedModelLocation("https://example.test/pet.model3.json")).toBe(true);
    expect(isSupportedModelLocation("https://example.test/pet.model.json")).toBe(true);
    const view = parseCustomModels(JSON.stringify({ models: [
      { id: "legacy", name: "Legacy", modelUrl: "https://example.test/pet.model.json" },
      { id: "legacy-local", name: "Legacy local", modelUrl: "C:/models", directoryGrantId: "grant", directoryPath: "Pet/model.json" },
      { id: "modern", name: "Modern", modelUrl: "https://example.test/pet.model3.json" },
    ] }));
    expect(view.models.map((model) => model.id)).toEqual(["legacy", "legacy-local", "modern"]);
  });
});
