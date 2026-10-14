import { describe, expect, it } from "vitest";
import { modelMotionDefinitions, modelMotionList, motionPlaybackScript, resolveMotionNames } from "./model-motions";

describe("model motion metadata", () => {
  it("uses modern references before legacy-looking top-level metadata", () => {
    const definitions = modelMotionDefinitions({
      FileReferences: { Motions: { Idle: [{ File: "idle.motion3.json" }] } },
      Motions: { Old: [] }, motions: { idle: [{ file: "idle.mtn" }] },
    });
    expect(Object.keys(definitions)).toEqual(["Idle"]);
    expect(modelMotionList(definitions)).toEqual([
      { group: "Idle", index: 0, label: "Idle / idle.motion3.json" },
    ]);
  });

  it("keeps native legacy names and indices when a preceding motion lacks a filename", () => {
    const definitions = modelMotionDefinitions({
      motions: { tap_body: [null, { file: "motions/touch.mtn" }] },
    });
    expect(modelMotionList(definitions)).toEqual([
      { group: "tap_body", index: 0, label: "tap_body / 0" },
      { group: "tap_body", index: 1, label: "tap_body / motions/touch.mtn" },
    ]);
  });

  it("does not mistake arrays or malformed group values for selectable motion groups", () => {
    expect(modelMotionDefinitions({ motions: [[], []] })).toEqual({});
    expect(modelMotionDefinitions({ FileReferences: { Motions: { Idle: [], bad: "motion.json", missing: null } } })).toEqual({ Idle: [] });
    expect(modelMotionDefinitions(null)).toEqual({});
  });

  it("resolves case and separator differences to native legacy groups", () => {
    expect(resolveMotionNames(["TapHead", "TapBody"], ["tap_head", "tap_body"])).toEqual(["tap_head", "tap_body"]);
    expect(resolveMotionNames(["Idle"], ["idle"])).toEqual(["idle"]);
    expect(resolveMotionNames(["Unknown"], ["idle"])).toEqual(["Unknown"]);
  });

  it.each([
    [{ Time: 1, Text: "Missing opening cue" }],
    [{ Time: 0, Text: "Opening" }, { Time: 0, Text: "Duplicate time" }],
    [{ Time: 0, Text: "Opening" }, { Time: 4, Text: "Outside loop" }],
    [{ Time: 0, Text: " " }],
    [{ Time: Number.NaN, Text: "Invalid time" }],
  ])("rejects unusable lyric timelines without changing the loop policy", (...cues) => {
    expect(motionPlaybackScript({ CCGUI: { Loop: true, Lyrics: { Duration: 4, Cues: cues } } })).toEqual({ loop: true });
    expect(motionPlaybackScript({ CCGUI: { Lyrics: { Duration: 4, Cues: cues } } })).toBeNull();
  });
});
