import { afterEach, describe, expect, it, vi } from "vitest";
import { PetRuntime } from "./runtime";
import type { PluginContext, SessionHooks, TurnHooks } from "./sdk";

function makeContext() {
  const values = new Map<string, unknown>();
  const documents = new Map<string, { content: string; version: string }>();
  let version = 0;
  let sessionHooks: SessionHooks | undefined;
  let turnHooks: TurnHooks | undefined;
  const ctx = {
    pluginId: "ccgui.live2d-pets",
    version: "1.0.0",
    react: {
      createElement() { return null; },
      Fragment: Symbol.for("react.fragment"),
      useEffect() {},
      useState<T>(initial: T | (() => T)) { return [typeof initial === "function" ? (initial as () => T)() : initial, () => {}] as [T, (value: T | ((current: T) => T)) => void]; },
      useRef<T>(current: T) { return { current }; },
      useCallback<T>(callback: T) { return callback; },
      useMemo<T>(factory: () => T) { return factory(); },
      useSyncExternalStore<T>(_subscribe: unknown, getSnapshot: () => T) { return getSnapshot(); },
    },
    hooks: {
      registerSessionHooks(hooks: SessionHooks) { sessionHooks = hooks; return () => { sessionHooks = undefined; }; },
      registerTurnHooks(hooks: TurnHooks) { turnHooks = hooks; return () => { turnHooks = undefined; }; },
      registerRuntimeSwitchHooks() { return () => {}; },
    },
    documentStorage: {
      async getLocation() { return { kind: "data", path: "C:/plugin-data/live2d" }; },
      async selectLocation() { return { kind: "data", path: "C:/plugin-data/live2d" }; },
      async readText(path: string) { return documents.get(path) ?? null; },
      async writeTextAtomic(path: string, content: string) {
        const next = { content, version: `v${++version}` };
        documents.set(path, next);
        return { version: next.version };
      },
      async remove(path: string) { documents.delete(path); },
      async list() { return [...documents.keys()]; },
    },
    assets: {
      bundleUrl(path: string) { return `plugin://bundle/${path}`; },
      documentUrl(path: string) { return `plugin://document/${path}`; },
      remoteUrl(url: string) { return url; },
      async grantDirectory() { return { grantId: "grant", path: "C:/models" }; },
      async listDirectories() { return []; },
      async revokeDirectory() {},
      directoryUrl(grantId: string, path: string) { return `plugin://directory/${grantId}/${path}`; },
    },
    shell: { async revealPath() {} },
    ui: {},
    theme: {},
    i18n: {},
    storage: {
      async get<T>(key: string) { return (values.get(key) as T | undefined) ?? null; },
      async set(key: string, value: unknown) { values.set(key, value); },
      async delete(key: string) { values.delete(key); },
    },
    events: { on() { return () => {}; }, emit() {} },
    host: { appVersion: "1.0.4", sdkVersion: "0.4.3", locale: "zh-CN", isWeb: false },
  } as unknown as PluginContext;
  return { ctx, documents, getSessionHooks: () => sessionHooks, getTurnHooks: () => turnHooks };
}

function turnEvent() {
  return {
    runId: "run-1",
    turnId: "turn-1",
    engine: "codex",
    sessionId: "session-1",
    workspace: { id: "workspace-1", path: "C:/work" },
    occurredAt: new Date(0).toISOString(),
  };
}

describe("PetRuntime", () => {
  afterEach(() => vi.useRealTimers());

  it("mirrors turn lifecycle and holds completion before returning idle", async () => {
    vi.useFakeTimers();
    const harness = makeContext();
    const runtime = new PetRuntime(harness.ctx);
    await runtime.waitUntilReady();

    harness.getTurnHooks()?.onTurnStarted?.(turnEvent());
    expect(runtime.snapshot().state).toBe("thinking");
    harness.getTurnHooks()?.onRuntimeEvent?.({ ...turnEvent(), eventId: "permission", workspaceId: "workspace-1", workspacePath: "C:/work", occurredAt: new Date(0).toISOString(), kind: "permission-requested", tool: "shell", path: null });
    expect(runtime.snapshot().state).toBe("waiting");
    harness.getTurnHooks()?.afterTurn?.({ ...turnEvent(), status: "completed" });
    expect(runtime.snapshot().state).toBe("done");

    vi.advanceTimersByTime(3499);
    expect(runtime.snapshot().state).toBe("done");
    vi.advanceTimersByTime(1);
    expect(runtime.snapshot().state).toBe("idle");
    runtime.dispose();
  });

  it("normalizes persisted settings before storing them", async () => {
    const harness = makeContext();
    const runtime = new PetRuntime(harness.ctx);
    await runtime.waitUntilReady();

    await runtime.setSettings([
      { op: "set", path: ["size"], value: 999 },
      { op: "set", path: ["maxFps"], value: 12 },
      { op: "set", path: ["enabled"], value: false },
    ]);
    expect(runtime.snapshot().config).toMatchObject({ size: 400, maxFps: 30, enabled: false });
    runtime.dispose();
  });

  it("ignores stale runtime events and persists a normalized display position", async () => {
    const harness = makeContext();
    const runtime = new PetRuntime(harness.ctx);
    await runtime.waitUntilReady();

    harness.getTurnHooks()?.onTurnStarted?.(turnEvent());
    harness.getTurnHooks()?.onRuntimeEvent?.({
      ...turnEvent(),
      turnId: "old-turn",
      eventId: "stale-error",
      workspaceId: "workspace-1",
      workspacePath: "C:/work",
      kind: "turn-failed",
    });
    expect(runtime.snapshot().state).toBe("thinking");

    await runtime.setDisplay({ right: -20, bottom: 5001, size: 999 });
    expect(runtime.snapshot().display).toEqual({ right: 0, bottom: 4000, size: 400 });
    expect(harness.ctx.storage).toBeDefined();
    runtime.dispose();
  });

  it("retains the last valid persona and model lists after malformed reloads", async () => {
    const harness = makeContext();
    const runtime = new PetRuntime(harness.ctx);
    await runtime.waitUntilReady();

    harness.documents.set("personas.jsonc", { content: JSON.stringify({ personas: [{ id: "quiet", base: "kuudere" }] }), version: "persona-good" });
    harness.documents.set("custom-models.jsonc", { content: JSON.stringify({ models: [{ id: "m1", name: "M1", modelUrl: "https://cdn.jsdelivr.net/m1.model3.json" }] }), version: "models-good" });
    await runtime.reloadPersonas();
    await runtime.loadCustomModels();
    expect(runtime.snapshot().customPersonas.map((persona) => persona.id)).toEqual(["quiet"]);
    expect(runtime.snapshot().customModels.map((model) => model.id)).toEqual(["m1"]);

    harness.documents.set("personas.jsonc", { content: "{bad", version: "persona-bad" });
    harness.documents.set("custom-models.jsonc", { content: "{bad", version: "models-bad" });
    await runtime.reloadPersonas();
    await runtime.loadCustomModels();
    expect(runtime.snapshot().customPersonas.map((persona) => persona.id)).toEqual(["quiet"]);
    expect(runtime.snapshot().customModels.map((model) => model.id)).toEqual(["m1"]);
    runtime.dispose();
  });
});
