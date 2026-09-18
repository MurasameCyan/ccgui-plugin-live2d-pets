import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const root = resolve(import.meta.dirname, "..");

describe("plugin package contract", () => {
  it("declares every runtime capability used by the entrypoint", () => {
    const manifest = JSON.parse(readFileSync(resolve(root, "manifest.json"), "utf8")) as {
      permissions: string[];
      tier: string;
      sdkVersion: string;
    };
    expect(manifest.tier).toBe("js");
    expect(manifest.sdkVersion).toBe("^0.4.3");
    expect(manifest.permissions).toEqual(expect.arrayContaining([
      "storage",
      "plugin.storage",
      "ui:settings-section",
      "ui:overlay",
      "ui:command",
      "session.lifecycle.read",
      "runtime.events.read",
      "assets:bundle",
      "assets:directory",
      "network:cdn.jsdelivr.net",
    ]));
  });

  it("ships all fixed runtime assets alongside the entry bundle", () => {
    for (const relativePath of [
      "assets/vendor/pixi.min.js",
      "assets/vendor/live2dcubismcore.min.js",
      "assets/vendor/live2d-display.cubism4.min.js",
      "assets/icons/paw-print.svg",
    ]) {
      expect(() => readFileSync(resolve(root, relativePath))).not.toThrow();
    }
  });
});
