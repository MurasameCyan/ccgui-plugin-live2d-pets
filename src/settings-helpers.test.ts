import { describe, expect, it } from "vitest";
import {
  EMPTY_SPATIAL_DRAFT,
  draftFromOverride,
  motionMapFromDraft,
  overrideFromDraft,
  draftFromMotionMap,
} from "./settings-helpers";


describe("settings model editors", () => {
  it("preserves only finite spatial overrides and clamps them", () => {
    const draft = {
      ...EMPTY_SPATIAL_DRAFT,
      headMaxNy: "1.4",
      bodyMinNx: "-0.2",
      bodyMaxNx: "not-a-number",
    };
    expect(overrideFromDraft(draft)).toEqual({ headMaxNy: 1, bodyMinNx: 0 });
  });

  it("maps legacy spatial keys into the current draft fields", () => {
    expect(draftFromOverride({ armLeftMaxNx: 0.35, armRightMinNx: 0.7 })).toMatchObject({
      bodyMinNx: "0.35",
      bodyMaxNx: "0.7",
    });
  });

  it("omits empty animation slots and round-trips configured slots", () => {
    const draft = draftFromMotionMap({ thinking: ["Work"], body: ["TapBody", ""] });
    expect(draft.thinking).toEqual(["Work"]);
    expect(motionMapFromDraft({ thinking: ["Work"], body: ["", "TapBody"] })).toEqual({
      thinking: ["Work"],
      body: ["TapBody"],
    });
    expect(motionMapFromDraft({})).toBeUndefined();
  });
});
