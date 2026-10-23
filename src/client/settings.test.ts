// @vitest-environment jsdom
import * as React from "react";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { CustomModelEntry } from "../models";
import type { CustomPersonaDef } from "../persona-shared";
import { clearReactRuntime, setReactRuntime } from "../react-runtime";
import { PetRuntime } from "../runtime";
import type { AssetFileGrant, ReactLike } from "../sdk";
import { makeContext } from "../test-context";
import { PetSettingsSection } from "./settings";

const REMOTE_URL = "https://cdn.jsdelivr.net/models/remote.model3.json";
const LOCAL_MODEL: CustomModelEntry = {
  id: "local-pet", name: "Local pet", modelUrl: "C:/models",
  directoryGrantId: "grant", directoryPath: "Pet/Pet.model3.json",
  spatialTap: { headMaxNy: 0.3 }, animationMap: { head: ["TapHead"] },
};
const REMOTE_MODEL: CustomModelEntry = { id: "remote-pet", name: "Remote pet", modelUrl: REMOTE_URL };
const cleanups: Array<() => void> = [];

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<T>((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
}

function field(container: ParentNode, placeholder: string): HTMLInputElement {
  const input = container.querySelector<HTMLInputElement>(`input[placeholder="${placeholder}"]`);
  expect(input, `input ${placeholder}`).not.toBeNull();
  return input!;
}

async function type(container: ParentNode, placeholder: string, value: string) {
  const input = field(container, placeholder);
  await act(async () => {
    // Use the native setter so React observes a real input event rather than
    // updating only its value tracker.
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

async function click(container: ParentNode, label: string, index = 0) {
  const button = [...container.querySelectorAll("button")].filter((candidate) => candidate.textContent === label)[index];
  expect(button, `button ${label} #${index}`).toBeDefined();
  await act(async () => { button!.click(); });
}

function customRows(container: ParentNode): HTMLElement {
  return container.querySelector<HTMLElement>('[role="radiogroup"][aria-label="我的模型"]')!;
}

function modelForm(container: ParentNode, mode: "new" | "edit" = "new"): HTMLElement {
  const label = mode === "new" ? "新增模型" : "编辑模型";
  return container.querySelector<HTMLElement>(`[role="group"][aria-label="${label}"]`)!;
}

function modelPath(container: ParentNode): string {
  return container.querySelector<HTMLElement>('[aria-label="模型路径"]')!.textContent!;
}

async function cancelModelEdit(container: ParentNode): Promise<void> {
  await act(async () => {
    modelForm(container, "edit").dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
  });
}

async function mountSettings(models: CustomModelEntry[] = [], selected?: string, personas: CustomPersonaDef[] = []) {
  const harness = makeContext();
  harness.documents.set("custom-models.jsonc", { content: JSON.stringify({ models }), version: "initial-models" });
  if (personas.length > 0) harness.documents.set("personas.jsonc", { content: JSON.stringify({ personas }), version: "initial-personas" });
  if (selected) await harness.ctx.storage.set("config", { model: selected });
  const grantFile = vi.spyOn(harness.ctx.assets, "grantFile");
  const remoteUrl = vi.spyOn(harness.ctx.assets, "remoteUrl");
  const revokeDirectory = vi.spyOn(harness.ctx.assets, "revokeDirectory");
  const runtime = new PetRuntime(harness.ctx);
  await runtime.ready;
  setReactRuntime(React as unknown as ReactLike);
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  let mounted = true;
  const unmount = () => {
    if (!mounted) return;
    mounted = false;
    root.unmount();
    runtime.dispose();
    container.remove();
  };
  cleanups.push(unmount);
  await act(async () => root.render(React.createElement(PetSettingsSection as React.ComponentType<{ runtime: PetRuntime }>, { runtime })));
  const savedModels = () => JSON.parse(harness.documents.get("custom-models.jsonc")!.content.replace(/^\/\/.*$/gm, "")).models as CustomModelEntry[];
  return { ...harness, runtime, container, unmount, savedModels, grantFile, remoteUrl, revokeDirectory };
}

async function fillLocalDraft(container: ParentNode) {
  await type(container, "名称", "New pet");
  await click(modelForm(container), "浏览");
}

describe("pet settings model sources", () => {
  beforeEach(() => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: true, json: async () => ({ FileReferences: { Motions: { Idle: [], TapHead: [] } } }) })));
  });

  afterEach(async () => {
    await act(async () => { for (const cleanup of cleanups.splice(0).reverse()) cleanup(); });
    clearReactRuntime();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it.each(["Haru.model3.json", "Shizuku.model.json"])("fills an empty local draft from %s and waits for Save", async (relativePath) => {
    const { container, ctx, runtime, savedModels } = await mountSettings();
    Object.assign(ctx.assets, {
      grantFile: async () => ({ grantId: "picked-file", path: "C:/models/Haru", relativePath }),
    });
    await click(container, "浏览");
    const name = relativePath.replace(/\.model3?\.json$/i, "");
    expect(field(container, "名称").value).toBe(name);
    expect(modelPath(modelForm(container))).toBe(`C:/models/Haru/${relativePath}`);
    expect(savedModels()).toEqual([]);
    await type(container, "名称", "My pet");
    await click(modelForm(container), "保存");
    const saved = savedModels()[0]!;
    expect(saved).toEqual({
      id: expect.any(String), name: "My pet", modelUrl: "C:/models/Haru",
      directoryGrantId: "picked-file", directoryPath: relativePath,
    });
    await act(async () => { await runtime.setSettings([{ op: "set", path: ["model"], value: saved.id }]); });
    expect(runtime.snapshot().config.modelUrl).toBe(`plugin://directory/picked-file/${relativePath}`);
  });

  it("preserves leading whitespace in a selected filename through Save and reload", async () => {
    const relativePath = " Haru.model3.json";
    const { container, ctx, runtime, savedModels, grantFile, unmount } = await mountSettings();
    grantFile.mockResolvedValueOnce({ grantId: "space-file", path: "C:/models", relativePath });
    await click(modelForm(container), "浏览");
    await click(modelForm(container), "保存");
    const saved = savedModels()[0]!;
    expect(saved.directoryPath).toBe(relativePath);
    await act(async () => { await runtime.setSettings([{ op: "set", path: ["model"], value: saved.id }]); });
    const expectedUrl = `plugin://directory/space-file/${relativePath}`;
    expect(runtime.snapshot().config.modelUrl).toBe(expectedUrl);
    await click(customRows(container), "修改");
    await click(customRows(container), "保存");
    expect(savedModels()[0]!.directoryPath).toBe(relativePath);
    await act(async () => unmount());
    const reloaded = new PetRuntime(ctx);
    try {
      await reloaded.ready;
      expect(reloaded.snapshot().config.modelUrl).toBe(expectedUrl);
      expect(reloaded.modelAssetUrl(saved.id)).toBe(expectedUrl);
    } finally {
      reloaded.dispose();
    }
  });

  it("keeps a manually named draft when a local model file is selected", async () => {
    const { container, ctx, savedModels } = await mountSettings();
    Object.assign(ctx.assets, {
      grantFile: async () => ({ grantId: "picked-file", path: "C:/models/Haru", relativePath: "Haru.model3.json" }),
    });
    await type(container, "名称", "Custom name");
    await click(modelForm(container), "浏览");
    expect(field(container, "名称").value).toBe("Custom name");
    await click(modelForm(container), "保存");
    expect(savedModels()[0]).toMatchObject({ name: "Custom name", directoryPath: "Haru.model3.json" });
  });

  it("preserves the selected local draft when file selection is cancelled", async () => {
    const { container, grantFile, savedModels } = await mountSettings();
    await fillLocalDraft(container);
    grantFile.mockResolvedValueOnce(null);
    await click(modelForm(container), "浏览");
    expect(field(modelForm(container), "名称").value).toBe("New pet");
    expect(modelPath(modelForm(container))).toBe("C:/models/Pet.model3.json");
    expect(savedModels()).toEqual([]);
    await click(modelForm(container), "保存");
    expect(savedModels()).toEqual([{
      id: expect.any(String), name: "New pet", modelUrl: "C:/models",
      directoryGrantId: "grant", directoryPath: "Pet.model3.json",
    }]);
  });

  it("uses the host menu styling for persona choices and persists a selection", async () => {
    const { container, runtime, ctx, unmount } = await mountSettings();
    const trigger = container.querySelector<HTMLButtonElement>('button[role="combobox"][aria-label="人设台词"]');

    expect(container.querySelector("select")).toBeNull();
    expect(trigger?.textContent).toContain("傲娇");
    expect(trigger?.getAttribute("aria-expanded")).toBe("false");

    await act(async () => { trigger!.click(); });
    const menu = container.querySelector<HTMLElement>('[role="listbox"][aria-label="人设台词"]');
    const options = [...(menu?.querySelectorAll<HTMLButtonElement>('[role="option"]') ?? [])];
    expect(trigger?.getAttribute("aria-expanded")).toBe("true");
    expect(menu?.className).toContain("rounded-2xl");
    expect(menu?.className).toContain("bg-background-primary-default");
    expect(options.map((option) => option.textContent)).toEqual(["傲娇", "元气", "天然呆", "三无", "温柔治愈", "病娇"]);

    await act(async () => { options[1]!.click(); await Promise.resolve(); });
    expect(runtime.snapshot().config.persona).toBe("genki");
    expect(trigger?.getAttribute("aria-expanded")).toBe("false");
    expect(container.querySelector('[role="listbox"]')).toBeNull();

    await act(async () => { unmount(); });
    const reloaded = new PetRuntime(ctx);
    await reloaded.ready;
    expect(reloaded.snapshot().config.persona).toBe("genki");
    reloaded.dispose();
  });

  it("supports keyboard navigation and dismisses the persona menu", async () => {
    const { container } = await mountSettings();
    const trigger = container.querySelector<HTMLButtonElement>('button[role="combobox"][aria-label="人设台词"]')!;

    await act(async () => { trigger.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true })); });
    const options = [...container.querySelectorAll<HTMLButtonElement>('[role="option"]')];
    expect(options[0]).toBe(document.activeElement);

    await act(async () => { options[0]!.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true })); });
    expect(options[1]).toBe(document.activeElement);

    await act(async () => { options[1]!.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })); await Promise.resolve(); });
    expect(container.querySelector('[role="listbox"]')).toBeNull();
    expect(trigger).toBe(document.activeElement);

    await act(async () => { trigger.click(); });
    await act(async () => { document.body.dispatchEvent(new Event("pointerdown", { bubbles: true })); });
    expect(container.querySelector('[role="listbox"]')).toBeNull();

    await act(async () => {
      trigger.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
      trigger.click();
    });
    expect(trigger.getAttribute("aria-expanded")).toBe("true");
    const selected = container.querySelector<HTMLButtonElement>('[role="option"][aria-selected="true"]')!;
    await act(async () => { selected.dispatchEvent(new KeyboardEvent("keydown", { key: "Tab", bubbles: true })); });
    expect(container.querySelector('[role="listbox"]')).toBeNull();
  });

  it("coalesces rapid size slider changes into one trailing write", async () => {
    vi.useFakeTimers();
    const { container, runtime } = await mountSettings();
    const input = container.querySelector<HTMLInputElement>('input[type="range"]')!;
    const setValue = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!;
    const setSettings = vi.spyOn(runtime, "setSettings");

    await act(async () => {
      for (const value of [320, 300, 280]) {
        setValue.call(input, String(value));
        input.dispatchEvent(new Event("input", { bubbles: true }));
      }
    });
    await act(async () => { vi.advanceTimersByTime(180); await Promise.resolve(); });

    expect(setSettings).toHaveBeenCalledTimes(1);
    expect(setSettings).toHaveBeenLastCalledWith([{ op: "set", path: ["size"], value: 280 }]);
    expect(runtime.snapshot().config.size).toBe(280);
    vi.useRealTimers();
  });

  it("scrolls a long persona menu and flips it above the trigger near the viewport edge", async () => {
    const personas = Array.from({ length: 20 }, (_, index) => ({ id: `custom-${index}`, name: `自定义人设 ${index}`, base: "tsundere" }));
    const { container } = await mountSettings([], undefined, personas);
    const trigger = container.querySelector<HTMLButtonElement>('button[role="combobox"][aria-label="人设台词"]')!;
    trigger.getBoundingClientRect = () => ({ x: 40, y: 700, top: 700, right: 108, bottom: 732, left: 40, width: 68, height: 32, toJSON: () => ({}) });

    await act(async () => { trigger.click(); });
    const menu = container.querySelector<HTMLElement>('[role="listbox"][aria-label="人设台词"]')!;
    expect(menu.querySelectorAll('[role="option"]')).toHaveLength(26);
    expect(menu.style.maxHeight).toBe("240px");
    expect(menu.style.overflowY).toBe("auto");
    expect(menu.style.bottom).toBe("calc(100% + 4px)");
    expect(menu.style.top).toBe("");
  });

  it("toggles keeping the pet animated while the window is inactive", async () => {
    const { container, runtime } = await mountSettings();
    const toggle = container.querySelector<HTMLButtonElement>('button[role="switch"][aria-label="窗口非激活时保持动态"]');
    expect(toggle, "inactive-animation switch").not.toBeNull();
    expect(toggle!.getAttribute("aria-checked")).toBe("false");

    await act(async () => { toggle!.click(); await Promise.resolve(); });
    expect(runtime.snapshot().config.keepAnimatingWhenInactive).toBe(true);
  });

  it("drives the developer options through switches, not checkboxes", async () => {
    const { container, runtime } = await mountSettings();
    expect(container.querySelector('input[type="checkbox"]'), "no raw checkbox remains").toBeNull();

    const developer = container.querySelector<HTMLButtonElement>('button[role="switch"][aria-label="启用开发者选项"]');
    expect(developer, "developer-mode switch").not.toBeNull();
    expect(developer!.getAttribute("aria-checked")).toBe("false");

    // The nested rows only exist once developer mode is on.
    expect(container.querySelector('button[role="switch"][aria-label="调试面板"]')).toBeNull();
    await act(async () => { developer!.click(); await Promise.resolve(); });
    expect(runtime.snapshot().config.developerMode).toBe(true);

    const debugPanel = container.querySelector<HTMLButtonElement>('button[role="switch"][aria-label="调试面板"]');
    expect(debugPanel, "debug-panel switch").not.toBeNull();
    await act(async () => { debugPanel!.click(); await Promise.resolve(); });
    expect(runtime.snapshot().config.debug).toBe(true);

    const tapZones = container.querySelector<HTMLButtonElement>('button[role="switch"][aria-label="显示点击分区（空间回退色块）"]');
    expect(tapZones, "tap-zone switch").not.toBeNull();
    await act(async () => { tapZones!.click(); await Promise.resolve(); });
    expect(runtime.snapshot().config.showTapZones).toBe(true);
  });



  it("adds a selected local file and retains its source after reload", async () => {
    const { container, runtime, savedModels, ctx, unmount } = await mountSettings();
    await fillLocalDraft(container);
    await click(modelForm(container), "保存");
    expect(savedModels()).toHaveLength(1);
    const saved = savedModels()[0]!;
    expect(saved).toMatchObject({ name: "New pet", modelUrl: "C:/models", directoryGrantId: "grant", directoryPath: "Pet.model3.json" });
    await act(async () => { await runtime.setSettings([{ op: "set", path: ["model"], value: saved.id }]); });
    expect(runtime.snapshot().config.modelUrl).toBe("plugin://directory/grant/Pet.model3.json");
    await act(async () => unmount());
    const reloaded = new PetRuntime(ctx);
    cleanups.push(() => reloaded.dispose());
    await reloaded.ready;
    expect(reloaded.snapshot().config.modelUrl).toBe("plugin://directory/grant/Pet.model3.json");
  });

  it("keeps the directory source and mappings when only a local model name changes", async () => {
    const { container, runtime, savedModels } = await mountSettings([LOCAL_MODEL], LOCAL_MODEL.id);
    await click(customRows(container), "修改");
    await type(customRows(container), "名称", "Renamed pet");
    await click(customRows(container), "保存");
    expect(savedModels()).toEqual([{ ...LOCAL_MODEL, name: "Renamed pet" }]);
    expect(runtime.snapshot().config.modelUrl).toBe("plugin://directory/grant/Pet/Pet.model3.json");
  });

  it("keeps legacy overrides unchanged when only a model name changes", async () => {
    const legacy: CustomModelEntry = {
      ...LOCAL_MODEL,
      spatialTap: { armLeftMaxNx: 0.35, armRightMinNx: 0.7 },
      animationMap: { body: ["tap_body"], thinking: ["Work"] },
    };
    const { container, savedModels } = await mountSettings([legacy]);
    await click(customRows(container), "修改");
    await type(customRows(container), "名称", "Renamed legacy");
    await click(customRows(container), "保存");
    expect(savedModels()).toEqual([{ ...legacy, name: "Renamed legacy" }]);
  });

  it("drops stale directory fields when saving an older mixed-source remote entry", async () => {
    const mixed = { ...REMOTE_MODEL, directoryGrantId: "old-grant", directoryPath: "Old.model3.json" };
    const { container, runtime, savedModels } = await mountSettings([mixed], mixed.id);
    await click(customRows(container), "修改");
    await click(customRows(container), "保存");
    expect(savedModels()).toEqual([REMOTE_MODEL]);
    expect(runtime.snapshot().config.modelUrl).toBe(REMOTE_URL);
  });

  it("changes a remote model to the selected local file without manually filling its path", async () => {
    const { container, runtime, savedModels, grantFile } = await mountSettings([REMOTE_MODEL], REMOTE_MODEL.id);
    grantFile.mockResolvedValueOnce({ grantId: "other-file", path: "C:/models/Other", relativePath: "Other.model3.json" });
    await click(customRows(container), "修改");
    await click(customRows(container), "浏览");
    expect(modelPath(modelForm(container, "edit"))).toBe("C:/models/Other/Other.model3.json");
    await click(customRows(container), "保存");
    expect(savedModels()).toEqual([{
      ...REMOTE_MODEL, modelUrl: "C:/models/Other", directoryGrantId: "other-file", directoryPath: "Other.model3.json",
    }]);
    expect(runtime.snapshot().config.modelUrl).toBe("plugin://directory/other-file/Other.model3.json");
  });

  it("rejects saving a configured remote model whose domain is not granted", async () => {
    const denied = { ...REMOTE_MODEL, modelUrl: "https://ungranted.test/Pet.model3.json" };
    const { container, savedModels, remoteUrl } = await mountSettings([denied]);
    remoteUrl.mockImplementation(() => { throw new Error("missing network permission"); });
    await click(customRows(container), "修改");
    await type(customRows(container), "名称", "Denied rename");
    await click(customRows(container), "保存");
    expect(savedModels()).toEqual([denied]);
    expect(modelForm(container, "edit")).not.toBeNull();
  });


  it("preserves a remote draft when file selection fails", async () => {
    const { container, savedModels, grantFile } = await mountSettings([REMOTE_MODEL]);
    grantFile.mockRejectedValueOnce(new Error("picker-unavailable"));
    await click(customRows(container), "修改");
    await type(customRows(container), "名称", "Still remote");
    await click(customRows(container), "浏览");
    expect(modelPath(modelForm(container, "edit"))).toBe(REMOTE_URL);
    expect(field(customRows(container), "名称").value).toBe("Still remote");
    expect(container.textContent).toContain("picker-unavailable");
    await click(customRows(container), "保存");
    expect(savedModels()).toEqual([{ ...REMOTE_MODEL, name: "Still remote" }]);
  });


  it("uses the latest file selection when picker requests finish out of order", async () => {
    const { container, grantFile, savedModels } = await mountSettings();
    const first = deferred<AssetFileGrant>();
    const second = deferred<AssetFileGrant>();
    grantFile.mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise);
    await type(container, "名称", "New pet");
    await click(modelForm(container), "浏览");
    await click(modelForm(container), "浏览");
    await act(async () => second.resolve({ grantId: "second", path: "C:/second", relativePath: "Second.model3.json" }));
    await act(async () => first.resolve({ grantId: "first", path: "C:/first", relativePath: "First.model3.json" }));
    expect(modelPath(modelForm(container))).toBe("C:/second/Second.model3.json");
    await click(modelForm(container), "保存");
    expect(savedModels()[0]).toMatchObject({ modelUrl: "C:/second", directoryGrantId: "second", directoryPath: "Second.model3.json" });
  });

  it("does not apply a cancelled editor's file result to another model", async () => {
    const { container, grantFile, savedModels } = await mountSettings([LOCAL_MODEL, REMOTE_MODEL]);
    const pending = deferred<AssetFileGrant>();
    grantFile.mockReturnValueOnce(pending.promise);
    await click(customRows(container), "修改", 0);
    await click(customRows(container), "浏览");
    await cancelModelEdit(container);
    await click(customRows(container), "修改", 1);
    await act(async () => pending.resolve({ grantId: "late", path: "C:/late-models", relativePath: "Late.model3.json" }));
    expect(modelPath(modelForm(container, "edit"))).toBe(REMOTE_URL);
    await click(customRows(container), "保存");
    expect(savedModels()).toEqual([LOCAL_MODEL, REMOTE_MODEL]);
  });

  it("does not show a previous editor's late file error in the current editor", async () => {
    const { container, grantFile } = await mountSettings([LOCAL_MODEL, REMOTE_MODEL]);
    const pending = deferred<AssetFileGrant>();
    grantFile.mockReturnValueOnce(pending.promise);
    await click(customRows(container), "修改", 0);
    await click(customRows(container), "浏览");
    await cancelModelEdit(container);
    await click(customRows(container), "修改", 1);
    await act(async () => pending.reject(new Error("stale-picker-error")));
    expect(container.textContent).not.toContain("stale-picker-error");
    expect(modelPath(modelForm(container, "edit"))).toBe(REMOTE_URL);
  });

  it("ignores a picker result when switching directly to another model editor", async () => {
    const { container, grantFile } = await mountSettings([LOCAL_MODEL, REMOTE_MODEL]);
    const pending = deferred<AssetFileGrant>();
    grantFile.mockReturnValueOnce(pending.promise);
    await click(customRows(container), "修改", 0);
    await click(customRows(container), "浏览");
    // Opening the remaining row replaces the active editor directly.
    await click(customRows(container), "修改");
    await act(async () => pending.resolve({ grantId: "late", path: "C:/late-models", relativePath: "Late.model3.json" }));
    expect(modelPath(modelForm(container, "edit"))).toBe(REMOTE_URL);
    expect(field(customRows(container), "名称").value).toBe(REMOTE_MODEL.name);
  });

  it.each(["resolve", "reject"] as const)("ignores a picker %s after the new model has been saved", async (outcome) => {
    const { container, grantFile, savedModels } = await mountSettings();
    const pending = deferred<AssetFileGrant>();
    await fillLocalDraft(container);
    grantFile.mockReturnValueOnce(pending.promise);
    await click(modelForm(container), "浏览");
    await click(modelForm(container), "保存");
    await act(async () => {
      if (outcome === "resolve") pending.resolve({ grantId: "late", path: "C:/late-models", relativePath: "Late.model3.json" });
      else pending.reject(new Error("saved-picker-error"));
    });
    expect(modelPath(modelForm(container))).toBe("未选择模型");
    expect(container.textContent).not.toContain("saved-picker-error");
    expect(savedModels()).toEqual([{
      id: expect.any(String), name: "New pet", modelUrl: "C:/models",
      directoryGrantId: "grant", directoryPath: "Pet.model3.json",
    }]);
  });

  it.each(["resolve", "reject"] as const)("ignores a picker %s after the edited model has been saved", async (outcome) => {
    const { container, grantFile, savedModels } = await mountSettings([REMOTE_MODEL]);
    const pending = deferred<AssetFileGrant>();
    grantFile.mockReturnValueOnce(pending.promise);
    await click(customRows(container), "修改");
    await click(customRows(container), "浏览");
    await click(customRows(container), "保存");
    await act(async () => {
      if (outcome === "resolve") pending.resolve({ grantId: "late", path: "C:/late-models", relativePath: "Late.model3.json" });
      else pending.reject(new Error("saved-picker-error"));
    });
    expect(modelForm(container, "edit")).toBeNull();
    expect(container.textContent).not.toContain("saved-picker-error");
    expect(savedModels()).toEqual([REMOTE_MODEL]);
  });

  it.each(["resolve", "reject"] as const)("settles a late picker %s after unmount without saving a model", async (outcome) => {
    const { container, grantFile, savedModels, unmount } = await mountSettings();
    const pending = deferred<AssetFileGrant>();
    grantFile.mockReturnValueOnce(pending.promise);
    await click(modelForm(container), "浏览");
    await act(async () => unmount());
    await act(async () => {
      if (outcome === "resolve") pending.resolve({ grantId: "late", path: "C:/late-models", relativePath: "Late.model3.json" });
      else pending.reject(new Error("unmounted-picker-error"));
    });
    expect(savedModels()).toEqual([]);
    expect(container.childElementCount).toBe(0);
  });
});
