import type { PluginContext, SessionHooks, TurnHooks } from "./sdk";

export function makeContext() {
  const values = new Map<string, unknown>();
  const documents = new Map<string, { content: string; version: string }>();
  const topics = new Map<string, Set<(data: unknown) => void>>();
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
    events: {
      on(topic: string, callback: (data: unknown) => void) {
        const set = topics.get(topic) ?? new Set();
        set.add(callback);
        topics.set(topic, set);
        return () => { set.delete(callback); };
      },
      emit(topic: string, data: unknown) {
        for (const callback of [...(topics.get(topic) ?? [])]) callback(data);
      },
    },
    host: { appVersion: "1.0.4", sdkVersion: "0.3.12", locale: "zh-CN", isWeb: false },
  } as unknown as PluginContext;
  return {
    ctx,
    documents,
    getSessionHooks: () => sessionHooks,
    getTurnHooks: () => turnHooks,
    /** 宿主 → 插件话题注入（如 session://activated）。 */
    emit(topic: string, data: unknown) {
      for (const callback of [...(topics.get(topic) ?? [])]) callback(data);
    },
  };
}

export function turnEvent() {
  return {
    runId: "run-1",
    turnId: "turn-1",
    engine: "codex",
    sessionId: "session-1",
    workspace: { id: "workspace-1", path: "C:/work" },
    occurredAt: new Date(0).toISOString(),
  };
}
