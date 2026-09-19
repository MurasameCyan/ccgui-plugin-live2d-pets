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
  /** 绘制区域（画布坐标）：驱动 gl.readPixels 的 alpha 包围盒。 */
  art?: { x0: number; x1: number; y0: number; y1: number };
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
  // 真实 PIXI 语义：回调按优先级从高到低执行，Application 把渲染挂在
  // LOW(-25)。读帧缓冲的回调必须排在它之后，否则读到的是空帧。
  const listeners: Array<{ fn: () => void; priority: number; once: boolean }> = [];
  let rendered = false;
  const ticker = {
    maxFPS: 0,
    add: vi.fn((fn: () => void, _context?: unknown, priority = 0) => { listeners.push({ fn, priority, once: false }); }),
    addOnce: vi.fn((fn: () => void, _context?: unknown, priority = 0) => { listeners.push({ fn, priority, once: true }); }),
    remove: vi.fn((fn: () => void) => {
      const index = listeners.findIndex((entry) => entry.fn === fn);
      if (index >= 0) listeners.splice(index, 1);
    }),
    start() { tickerRunning = true; },
    stop() { tickerRunning = false; },
  };
  /** 跑一帧：按优先级降序执行，一次性回调执行前摘除。 */
  const frame = () => {
    for (const entry of [...listeners].sort((a, b) => b.priority - a.priority)) {
      if (entry.once) ticker.remove(entry.fn);
      entry.fn();
    }
  };
  // WebGL 回读只在本帧渲染之后才有内容：渲染前读到的是全透明缓冲。
  // 记录的调用顺序用于断言「resize 后同帧重绘」。
  const calls: string[] = [];
  let canvasEl: HTMLCanvasElement | null = null;
  const glMock = options.art && {
    RGBA: 6408,
    UNSIGNED_BYTE: 5121,
    readPixels: (rx: number, ry: number, w: number, h: number, _format: number, _type: number, pixels: Uint8Array) => {
      if (!rendered || !canvasEl) return;
      const art = options.art!;
      const canvasHeight = canvasEl.height;
      for (let y = 0; y < h; y += 1) {
        // GL 原点在左下，换算成画布坐标。
        const canvasY = canvasHeight - 1 - (ry + y);
        if (canvasY < art.y0 || canvasY > art.y1) continue;
        for (let x = 0; x < w; x += 1) {
          const canvasX = rx + x;
          if (canvasX < art.x0 || canvasX > art.x1) continue;
          pixels[(y * w + x) * 4 + 3] = 255;
        }
      }
    },
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
      renderer = {
        resize: vi.fn((width: number, height: number) => { calls.push(`resize:${width}x${height}`); }),
        gl: glMock,
      };
      render = vi.fn(() => { calls.push("render"); });
      destroy = destroy;
      constructor(options?: { view?: HTMLCanvasElement }) {
        if (options?.view) canvasEl = options.view;
        tickerRunning = true;
        // Application 自己的渲染回调：优先级 LOW(-25)。
        listeners.push({ fn: () => { rendered = true; }, priority: -25, once: false });
      }
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
  const canvas = anchor.querySelector("canvas") as HTMLCanvasElement | null;
  if (canvas) {
    // jsdom 不布局：把画布矩形折算成位图尺寸，指针命中探测才能换算坐标。
    canvas.getBoundingClientRect = () => ({
      x: 0, y: 0, left: 0, top: 0, right: canvas.width, bottom: canvas.height,
      width: canvas.width, height: canvas.height, toJSON: () => ({}),
    }) as DOMRect;
  }
  return {
    ...harness, runtime, anchor, scripts, ticker, frame, loadModel, destroy, unmount, calls,
    isTicking: () => tickerRunning,
    modelCanvas: () => anchor.querySelector("canvas") as HTMLCanvasElement | null,
  };
}

function pointer(target: HTMLCanvasElement, type: string, x: number, y: number) {
  // jsdom has no pointer capture; the browser API is the only mocked DOM seam.
  target.setPointerCapture = () => {};
  const event = new MouseEvent(type, { clientX: x, clientY: y, bubbles: true });
  Object.defineProperty(event, "pointerId", { value: 1 });
  target.dispatchEvent(event);
}

/** 预热：隐藏画布累积绘制区域样本后才定形并显示，需要跑若干帧。 */
async function settle(harness: { frame: () => void }, frames = 24): Promise<void> {
  await act(async () => { for (let index = 0; index < frames; index += 1) harness.frame(); });
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

  it("loads the CSP-compatible PIXI adapter before the Live2D renderer", async () => {
    const { scripts, loadModel } = await mountPet();
    expect(scripts.map((script) => script.src.split("/vendor/")[1])).toEqual([
      "pixi.min.js",
      "pixi-unsafe-eval.min.js",
      "live2dcubismcore.min.js",
      "live2d-display.cubism4.min.js",
    ]);
    expect(loadModel).toHaveBeenCalledOnce();
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

  it("keeps the pet inside the viewport when dragged, and docks at the edges", async () => {
    const { anchor } = await mountPet();
    const canvas = anchor.querySelector("canvas")!;
    const width = canvas.width;
    const height = canvas.height;

    // 大幅向左上拖动：不得越出画面（right ≤ 视口宽 - 画布宽）。
    pointer(canvas, "pointerdown", 500, 500);
    pointer(canvas, "pointermove", -200, -200);
    expect(anchor.style.right).toBe(`${window.innerWidth - width}px`);
    expect(anchor.style.bottom).toBe(`${window.innerHeight - height}px`);

    // 向右下拖动：贴住右/下边（right/bottom = 0）。
    pointer(canvas, "pointerdown", 0, 0);
    pointer(canvas, "pointermove", 1200, 1200);
    expect(anchor.style.right).toBe("0px");
    expect(anchor.style.bottom).toBe("0px");
    await act(async () => { pointer(canvas, "pointerup", 1200, 1200); });
  });

  it("fits the canvas to the drawn area after the warmup samples", async () => {
    const canvasW = 240;
    const canvasH = 472;
    const model = makeModel();
    // 绘制区域：画布坐标 x 100..139 (40px), y 200..299 (100px)。
    const harness = await mountPet({ art: { x0: 100, x1: 139, y0: 200, y1: 299 }, model });
    const { anchor } = harness;
    const canvas = anchor.querySelector("canvas")!;
    expect(canvas.width).toBe(canvasW);
    expect(canvas.height).toBe(canvasH);
    expect(canvas.style.visibility).toBe("hidden"); // 出现前先隐藏，避免出现后再改尺寸

    await settle(harness);

    // 尺寸语义：size = 可见宽度。绘制区域 40x100px 撑满后 canvas 约 240x588，
    // 模型钉在画布右/下边（之后扩画布不会移动它）。
    expect(canvas.width).toBe(canvasW);
    expect(canvas.height).toBe(588);
    expect(canvas.style.visibility).toBe("");
    const [px, py] = model.position.set.mock.calls.at(-1) as [number, number];
    expect(Math.round(px)).toBe(120);
    expect(Math.round(py)).toBe(213);
  });

  it("keeps animating while the window is inactive only when the switch is on", async () => {
    const off = await mountPet();
    await act(async () => { window.dispatchEvent(new Event("blur")); });
    expect(off.isTicking()).toBe(false);

    const on = await mountPet({ config: { keepAnimatingWhenInactive: true } });
    await act(async () => { window.dispatchEvent(new Event("blur")); });
    expect(on.isTicking()).toBe(true);
    await act(async () => { await on.runtime.setSettings([{ op: "set", path: ["keepAnimatingWhenInactive"], value: false }]); });
    expect(on.isTicking()).toBe(false);
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

  it("repaints immediately when a size change resizes the canvas", async () => {
    const { runtime, calls, frame } = await mountPet();
    await act(async () => { frame(); });
    calls.length = 0;
    let raf: FrameRequestCallback | null = null;
    vi.spyOn(window, "requestAnimationFrame").mockImplementation((callback) => { raf = callback; return 1; });

    await act(async () => {
      await runtime.setSettings([{ op: "set", path: ["size"], value: 300 }]);
      raf?.(0);
    });

    // 画布重设会清空位图：同一帧内必须重绘，否则拖动尺寸时会出现空白帧。
    const resizeAt = calls.findIndex((entry) => entry.startsWith("resize:"));
    const renderAt = calls.indexOf("render", resizeAt + 1);
    expect(resizeAt).toBeGreaterThanOrEqual(0);
    expect(renderAt).toBeGreaterThan(resizeAt);
  });

  it("caps the rendered size so the whole model stays inside the viewport", async () => {
    // 40x300 的高瘦绘制区域：按可见宽度 400 渲染会远超视口高度。
    const art = { x0: 100, x1: 139, y0: 100, y1: 399 };
    const { anchor, frame } = await mountPet({ art, config: { size: 400 } });
    await act(async () => { frame(); });

    const canvas = anchor.querySelector("canvas")!;
    expect(canvas.height).toBeLessThanOrEqual(window.innerHeight - 16);
    expect(canvas.width).toBeLessThan(400);
    expect(canvas.width).toBeGreaterThan(40);
  });

  it("grows the canvas for a later pose without ever changing the model scale", async () => {
    const art = { x0: 100, x1: 139, y0: 200, y1: 299 };
    const model = makeModel();
    const harness = await mountPet({ art, model });
    await settle(harness);
    const canvas = harness.anchor.querySelector("canvas")!;
    const fitted = { width: canvas.width, height: canvas.height };
    expect(fitted).toEqual({ width: 240, height: 588 });
    const scaleCalls = model.scale.set.mock.calls.length;

    // 动作把绘制区域撑到画布边缘：只扩画布，缩放必须保持不变（桌宠不会突然变小）。
    art.x0 = 0; art.x1 = 239; art.y0 = 0; art.y1 = 587;
    await settle(harness, 40);

    expect(model.scale.set.mock.calls.length).toBe(scaleCalls);
    expect(canvas.width).toBeGreaterThanOrEqual(fitted.width);
    expect(canvas.height).toBeGreaterThanOrEqual(fitted.height);
    expect(canvas.width > fitted.width || canvas.height > fitted.height).toBe(true);
  });

  it("expands the canvas when the drawn area reaches a canvas edge", async () => {
    // 顶部贴边的绘制区域说明测量被画布截断，需要外扩后重新定形。
    const art = { x0: 100, x1: 139, y0: 0, y1: 99 };
    const harness = await mountPet({ art });
    await settle(harness);

    const canvas = harness.anchor.querySelector("canvas")!;
    expect(canvas.height).toBeGreaterThan(600);
    expect(canvas.width).toBe(240);
  });

  it("lets pointer input through where the model has no pixels", async () => {
    const art = { x0: 100, x1: 139, y0: 200, y1: 299 };
    const { frame, modelCanvas } = await mountPet({ art });
    await act(async () => { frame(); });

    const canvas = modelCanvas()!;
    expect(canvas.style.pointerEvents).toBe("auto");

    // 无像素处：画布改为不拦截指针，点击落到下方宿主组件。
    canvas.dispatchEvent(new MouseEvent("pointermove", { clientX: 10, clientY: 10, bubbles: true }));
    await act(async () => { frame(); });
    expect(canvas.style.pointerEvents).toBe("none");

    // 有像素处：恢复拦截，桌宠仍可点击/拖动。
    canvas.dispatchEvent(new MouseEvent("pointermove", { clientX: 120, clientY: 250, bubbles: true }));
    await act(async () => { frame(); });
    expect(canvas.style.pointerEvents).toBe("auto");
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
