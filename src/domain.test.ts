import { describe, expect, it } from "vitest";
import { parseCustomModels } from "./custom-models";
import { mergeSpatialTap, DEFAULT_SPATIAL_TAP } from "./models";
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

  it("clamps spatial tap overrides and preserves default motion fallbacks", () => {
    expect(mergeSpatialTap({ headMaxNy: 2, bodyMinNx: -1 })).toMatchObject({
      headMaxNy: 1,
      bodyMinNx: 0,
      bodyMaxNx: DEFAULT_SPATIAL_TAP.bodyMaxNx,
    });
    expect(resolveMotionMap("hiyori", []).idle).toEqual(["Idle"]);
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
    expect(view.error).toContain("非法条目");
  });
});
