// @vitest-environment jsdom
import * as React from "react";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PetRuntime, type PetConfig } from "../runtime";
import { clearReactRuntime, setReactRuntime } from "../react-runtime";
import type { PetDisplay } from "../persist";
import type { ReactLike } from "../sdk";
import { makeContext, turnEvent } from "../test-context";
import { createPetOverlay } from "./index";

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<T>((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
}

function makeModel() {
  return {
    width: 100,
    height: 200,
    autoUpdate: true,
    anchor: { set: vi.fn() },
    scale: { set: vi.fn() },
    position: { set: vi.fn() },
    motion: vi.fn(async () => true),
    destroy: vi.fn(),
    focus: vi.fn(),
    hitTest: () => ["Head"],
    internalModel: {
      hitAreas: { Head: {} },
      focusController: { focus: vi.fn() },
      motionManager: { on: vi.fn(), off: vi.fn(), stopAllMotions: vi.fn(), definitions: {} },
    },
  };
}

let mountId = 0;
const cleanups: Array<() => void> = [];

async function mountPet(options: {
  display?: Partial<PetDisplay>;
  config?: Partial<PetConfig>;
  vendor?: "ready" | "pending" | "failed";
  model?: ReturnType<typeof makeModel>;
  modelReady?: Promise<void>;
} = {}) {
  const harness = makeContext();
  const id = ++mountId;
  harness.ctx.assets.bundleUrl = (path) => `https://plugin-assets.test/${id}/${path}`;
  await harness.ctx.storage.set("display", { right: 180, bottom: 120, ...options.display });
  await harness.ctx.storage.set("config", { size: 240, ...options.config });
  const runtime = new PetRuntime(harness.ctx);
  await runtime.ready;

  const scripts: HTMLScriptElement[] = [];
  const appendChild = document.head.appendChild.bind(document.head);
  vi.spyOn(document.head, "appendChild").mockImplementation((node) => {
    const result = appendChild(node);
    if (node instanceof HTMLScriptElement) {
      scripts.push(node);
      if (options.vendor !== "pending") {
        queueMicrotask(() => node.dispatchEvent(new Event(options.vendor === "failed" ? "error" : "load")));
      }
    }
    return result;
  });

  let tickerRunning = false;
  const ticker = {
    maxFPS: 0,
    addOnce: vi.fn(),
    start() { tickerRunning = true; },
    stop() { tickerRunning = false; },
  };
  const destroy = vi.fn(() => { tickerRunning = false; });
  type LoadOptions = {
    autoInteract?: boolean;
    autoUpdate?: boolean;
    onLoad?(): void;
    onError?(error: unknown): void;
  };
  const loadModel = vi.fn((_url: string, _options?: LoadOptions) => options.model ?? makeModel());
  const modelReady = options.modelReady ?? Promise.resolve();
  vi.stubGlobal("PIXI", {
    Application: class {
      stage = { addChild: vi.fn() };
      ticker = ticker;
      renderer = { resize: vi.fn() };
      destroy = destroy;
      constructor() { tickerRunning = true; }
    },
    live2d: { Live2DModel: {
      async from(url: string, loadOptions?: LoadOptions) {
        const loaded = loadModel(url, loadOptions);
        await modelReady;
        return loaded;
      },
      fromSync(url: string, loadOptions?: LoadOptions) {
        const loaded = loadModel(url, loadOptions);
        // Match the vendor: return the instance before async setup settles.
        void modelReady.then(loadOptions?.onLoad).catch(loadOptions?.onError);
        return loaded;
      },
    } },
  });

  setReactRuntime(React as unknown as ReactLike);
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  const Overlay = createPetOverlay(runtime) as React.ComponentType;
  let mounted = true;
  const unmount = () => {
    if (!mounted) return;
    mounted = false;
    root.unmount();
    runtime.dispose();
    container.remove();
  };
  cleanups.push(unmount);
  await act(async () => { root.render(React.createElement(Overlay)); });
  const anchor = container.firstElementChild as HTMLDivElement;
  return { ...harness, runtime, anchor, scripts, ticker, loadModel, destroy, unmount, isTicking: () => tickerRunning };
}

function pointer(target: HTMLCanvasElement, type: string, x: number, y: number) {
  // jsdom has no pointer capture; the browser API is the only mocked DOM seam.
  target.setPointerCapture = () => {};
  const event = new MouseEvent(type, { clientX: x, clientY: y, bubbles: true });
  Object.defineProperty(event, "pointerId", { value: 1 });
  target.dispatchEvent(event);
}

describe("pet overlay display lifecycle", () => {
  beforeEach(() => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  });

  afterEach(async () => {
    await act(async () => { for (const cleanup of cleanups.splice(0).reverse()) cleanup(); });
    clearReactRuntime();
    document.head.querySelectorAll('script[src^="https://plugin-assets.test/"]').forEach((script) => script.remove());
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("resets the visible position without resetting the configured size", async () => {
    const { runtime, anchor, ctx } = await mountPet();
    expect(anchor.style.right).toBe("180px");
    expect(anchor.querySelector("canvas")?.width).toBe(240);

    await act(async () => { await runtime.resetDisplay(); });

    expect(anchor.style.right).toBe("24px");
    expect(anchor.style.bottom).toBe("20px");
    expect(runtime.snapshot().config.size).toBe(240);
    expect(anchor.querySelector("canvas")?.width).toBe(240);
    expect(await ctx.storage.get("display")).toMatchObject({ right: 24, bottom: 20 });
  });

  it("keeps live drag coordinates across unrelated host events and saves the drop", async () => {
    const { runtime, anchor, getTurnHooks, ctx } = await mountPet();
    const canvas = anchor.querySelector("canvas")!;
    pointer(canvas, "pointerdown", 100, 100);
    pointer(canvas, "pointermove", 60, 50);
    expect(anchor.style.right).toBe("220px");
    expect(anchor.style.bottom).toBe("170px");

    getTurnHooks()?.onTurnStarted?.(turnEvent());
    expect(runtime.snapshot().state).toBe("thinking");
    expect(anchor.style.right).toBe("220px");
    await act(async () => { pointer(canvas, "pointerup", 60, 50); });

    expect(await ctx.storage.get("display")).toMatchObject({ right: 220, bottom: 170 });
    expect(anchor.style.right).toBe("220px");
  });

  it("applies resets while vendor scripts are still loading", async () => {
    const { runtime, anchor, scripts, loadModel } = await mountPet({ vendor: "pending" });
    expect(scripts).toHaveLength(1);
    expect(loadModel).not.toHaveBeenCalled();

    await act(async () => { await runtime.resetDisplay(); });

    expect(anchor.style.right).toBe("24px");
    expect(anchor.style.bottom).toBe("20px");
  });

  it("keeps the fallback position and visibility reactive after a vendor failure", async () => {
    const { runtime, anchor } = await mountPet({ vendor: "failed" });
    expect(anchor.textContent).toContain("🐾");

    await act(async () => { await runtime.resetDisplay(); });
    expect(anchor.style.right).toBe("24px");
    await act(async () => { await runtime.setSettings([{ op: "set", path: ["enabled"], value: false }]); });
    expect(anchor.style.display).toBe("none");
    await act(async () => { await runtime.setSettings([{ op: "set", path: ["enabled"], value: true }]); });
    expect(anchor.style.display).toBe("");
    expect(anchor.textContent).toContain("🐾");
  });

  it("honors display updates and pause while a model request is pending", async () => {
    const model = deferred<void>();
    const { runtime, anchor, isTicking } = await mountPet({ modelReady: model.promise });
    expect(anchor.querySelector("canvas")).not.toBeNull();

    await act(async () => {
      await runtime.resetDisplay();
      await runtime.setSettings([{ op: "set", path: ["enabled"], value: false }]);
    });
    expect(anchor.style.right).toBe("24px");
    expect(anchor.style.display).toBe("none");
    expect(isTicking()).toBe(false);

    await act(async () => { model.resolve(); });
    expect(anchor.style.display).toBe("none");
    expect(isTicking()).toBe(false);
  });

  it("stops a newly created ticker when the pet starts disabled", async () => {
    const model = deferred<void>();
    const { anchor, isTicking } = await mountPet({ modelReady: model.promise, config: { enabled: false } });
    expect(anchor.querySelector("canvas")).not.toBeNull();
    expect(anchor.style.display).toBe("none");
    expect(isTicking()).toBe(false);
    await act(async () => { model.resolve(); });
  });

  it("still applies resets after model loading falls back", async () => {
    const model = deferred<void>();
    const { runtime, anchor } = await mountPet({ modelReady: model.promise });
    await act(async () => { model.reject(new Error("model unavailable")); });
    expect(anchor.textContent).toContain("🐾");
    expect(anchor.querySelector("canvas")).toBeNull();

    await act(async () => { await runtime.resetDisplay(); });
    expect(anchor.style.right).toBe("24px");
    expect(anchor.style.bottom).toBe("20px");
  });

  it("does not create a late fallback after the overlay has unmounted", async () => {
    const { anchor, scripts, unmount, getTurnHooks } = await mountPet({ vendor: "pending" });
    await act(async () => {
      unmount();
      scripts[0].dispatchEvent(new Event("error"));
    });
    expect(anchor.isConnected).toBe(false);
    expect(anchor.textContent).not.toContain("🐾");
    expect(getTurnHooks()).toBeUndefined();
  });

  it("serializes model switches with the initial load and keeps the latest size", async () => {
    const first = deferred<void>();
    const { runtime, anchor, loadModel } = await mountPet({ modelReady: first.promise });
    loadModel.mockReturnValue(makeModel());
    vi.spyOn(window, "requestAnimationFrame").mockReturnValue(1);

    await act(async () => {
      await runtime.setSettings([
        { op: "set", path: ["model"], value: "haru" },
        { op: "set", path: ["size"], value: 300 },
      ]);
    });
    expect(loadModel).toHaveBeenCalledTimes(1);

    await act(async () => { first.resolve(); });
    expect(loadModel).toHaveBeenCalledTimes(2);
    expect(loadModel.mock.calls[1][0]).toBe(runtime.snapshot().config.modelUrl);
    expect(anchor.querySelectorAll("canvas")).toHaveLength(2);
    expect(anchor.querySelector("canvas")?.width).toBe(300);
  });

  it("releases a model that resolves after its overlay has unmounted", async () => {
    const pending = deferred<void>();
    const loaded = makeModel();
    const { anchor, unmount } = await mountPet({ model: loaded, modelReady: pending.promise });
    await act(async () => { unmount(); pending.resolve(); });

    expect(loaded.destroy).toHaveBeenCalledOnce();
    expect(anchor.isConnected).toBe(false);
    expect(anchor.querySelector("canvas")).toBeNull();
  });

  it("releases the mounted model when the overlay is removed", async () => {
    const loaded = makeModel();
    const { unmount } = await mountPet({ model: loaded });
    await act(async () => { unmount(); });
    expect(loaded.destroy).toHaveBeenCalledOnce();
  });

  it("releases a partially initialized model when texture loading fails", async () => {
    const pending = deferred<void>();
    const partial = makeModel();
    const { anchor, unmount } = await mountPet({ model: partial, modelReady: pending.promise });
    expect(partial.destroy).not.toHaveBeenCalled();

    await act(async () => { pending.reject(new Error("texture loading failed")); });
    expect(partial.destroy).toHaveBeenCalledOnce();
    expect(anchor.textContent).toContain("🐾");
    expect(anchor.querySelector("canvas")).toBeNull();

    await act(async () => { unmount(); });
    expect(partial.destroy).toHaveBeenCalledOnce();
  });

  it("releases a partial model whose setup fails after its overlay unmounts", async () => {
    const pending = deferred<void>();
    const partial = makeModel();
    const { anchor, unmount } = await mountPet({ model: partial, modelReady: pending.promise });
    await act(async () => { unmount(); });
    await act(async () => { pending.reject(new Error("late texture loading failure")); });

    expect(partial.destroy).toHaveBeenCalledOnce();
    expect(anchor.isConnected).toBe(false);
    expect(anchor.textContent).not.toContain("🐾");
    expect(anchor.querySelector("canvas")).toBeNull();
  });

  it.each([false, true])("avoids unsafe model destruction on early setup failure (unmounted: %s)", async (unmountFirst) => {
    const pending = deferred<void>();
    const uninitialized = makeModel();
    Reflect.deleteProperty(uninitialized, "internalModel");
    uninitialized.destroy.mockImplementation(() => { throw new Error("internalModel is not initialized"); });
    const { anchor, unmount } = await mountPet({ model: uninitialized, modelReady: pending.promise });
    if (unmountFirst) await act(async () => { unmount(); });

    await act(async () => { pending.reject(new Error("model JSON loading failed")); });

    expect(uninitialized.destroy).not.toHaveBeenCalled();
    expect(anchor.textContent?.includes("🐾")).toBe(!unmountFirst);
    expect(anchor.querySelector("canvas")).toBeNull();
  });

  it("uses the last requested size when settings return to the rendered size before a frame", async () => {
    const { runtime, anchor } = await mountPet();
    let frame!: FrameRequestCallback;
    vi.spyOn(window, "requestAnimationFrame").mockImplementation((callback) => { frame = callback; return 1; });
    await act(async () => {
      await runtime.setSettings([{ op: "set", path: ["size"], value: 300 }]);
      await runtime.setSettings([{ op: "set", path: ["size"], value: 240 }]);
      frame(0);
    });
    expect(runtime.snapshot().config.size).toBe(240);
    expect(anchor.querySelector("canvas")?.width).toBe(240);
  });

  it("cancels a drag when its canvas is replaced so the next reset takes effect", async () => {
    const { runtime, anchor } = await mountPet();
    const previous = anchor.querySelector("canvas")!;
    pointer(previous, "pointerdown", 100, 100);
    pointer(previous, "pointermove", 60, 50);

    await act(async () => { await runtime.setSettings([{ op: "set", path: ["model"], value: "haru" }]); });
    const replacement = anchor.querySelector("canvas")!;
    expect(replacement).not.toBe(previous);
    await act(async () => { await runtime.resetDisplay(); });
    expect(anchor.style.right).toBe("24px");
    expect(anchor.style.bottom).toBe("20px");
    pointer(replacement, "pointermove", 40, 30);
    expect(anchor.style.right).toBe("24px");
  });

  it("pauses the model's shared-ticker subscription as well as application rendering", async () => {
    const loaded = makeModel();
    const { runtime, loadModel, isTicking } = await mountPet({ model: loaded });
    expect(loadModel.mock.calls[0][1]).toMatchObject({ autoInteract: false, autoUpdate: false });
    expect(loaded.autoUpdate).toBe(true);
    await act(async () => { await runtime.setSettings([{ op: "set", path: ["enabled"], value: false }]); });
    expect(loaded.autoUpdate).toBe(false);
    expect(isTicking()).toBe(false);
    await act(async () => { await runtime.setSettings([{ op: "set", path: ["enabled"], value: true }]); });
    expect(loaded.autoUpdate).toBe(true);
    window.dispatchEvent(new Event("blur"));
    expect(loaded.autoUpdate).toBe(false);
    window.dispatchEvent(new Event("focus"));
    expect(loaded.autoUpdate).toBe(true);
  });
});
