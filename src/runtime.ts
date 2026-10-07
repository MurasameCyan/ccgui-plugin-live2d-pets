import type {
  AfterTurnEvent,
  AssetDirectoryGrant,
  Disposer,
  NormalizedRuntimeEvent,
  PluginContext,
  SessionHooks,
  TurnHooks,
} from "./sdk";
import { DEFAULT_DISPLAY, normalizeDisplay, type PetDisplay } from "./persist";
import { parseCustomModels, serializeCustomModels, type CustomModelsFileView } from "./custom-models";
import { parsePersonas, PERSONAS_TEMPLATE, type PersonasFileView } from "./personas";
import { DEFAULT_PERSONA_ID, type CustomPersonaDef } from "./persona-shared";
import { type CustomModelEntry, type MotionMap, type SpatialTapConfig } from "./models";
import { listBuiltinPresets, resolveModelLocation, resolveMotionMap, resolveSpatialTap } from "./models-host";
import { modelMotionDefinitions } from "./model-motions";


export type PetState = "idle" | "thinking" | "error" | "done" | "waiting";
export type MaxFpsOption = 0 | 30 | 60;
export interface PetConfig {
  enabled: boolean;
  size: number;
  maxFps: MaxFpsOption;
  model: string;
  developerMode: boolean;
  debug: boolean;
  showTapZones: boolean;
  persona: string;
  keepAnimatingWhenInactive: boolean;
}
export interface PetStateView {
  state: PetState;
  agent: string;
  config: PetConfig & {
    modelUrl: string | null;
    spatialTap: SpatialTapConfig;
    motionMap: MotionMap;
  };
  display: PetDisplay;
  customModels: CustomModelEntry[];
  customModelsError: string | null;
  customPersonas: CustomPersonaDef[];
  personasError: string | null;
  personasFile: string;
  customModelsFile: string;
  version: number;
}
export type SettingsOp = { op: "set" | "unset"; path: string[]; value?: unknown };

const DEFAULT_CONFIG: PetConfig = {
  enabled: true,
  size: 160,
  maxFps: 30,
  model: "hiyori",
  developerMode: false,
  debug: false,
  showTapZones: false,
  persona: DEFAULT_PERSONA_ID,
  keepAnimatingWhenInactive: false,
};
const CONFIG_KEYS: readonly (keyof PetConfig)[] = [
  "enabled", "size", "maxFps", "model", "developerMode", "debug", "showTapZones", "persona",
  "keepAnimatingWhenInactive",
];
const DONE_HOLD_MS = 3500;
/** 已退休回合 id 的保留上限：迟到事件不得复活它们，但记录不能无界增长。 */
const RETIRED_TURNS_LIMIT = 64;
const PERSONAS_FILE = "personas.jsonc";
const CUSTOM_MODELS_FILE = "custom-models.jsonc";
const DISPLAY_KEY = "display";
const CONFIG_KEY = "config";
/** 宿主激活会话话题（SDK 0.3.8）：`{ engine, sessionId }`；pending 标签页 sessionId 为 null。 */
const SESSION_ACTIVATED_TOPIC = "session://activated";

/** 活跃会话引用；`sessionId` 为 null 表示宿主尚未返回 native ID 的 pending 标签页。 */
interface SessionRef { engine: string; sessionId: string | null; workspacePath?: string }
/** 单会话的回合跟踪记录。 */
interface TrackedTurn {
  engine: string;
  sessionId: string | null;
  workspacePath: string;
  /** 跟踪中的回合；到达终态后置空，避免迟到事件复活已结束的回合。 */
  turnId: string | null;
  state: PetState;
  timer?: ReturnType<typeof setTimeout>;
}

type Listener = (view: PetStateView) => void;

function childPath(root: string, name: string): string {
  return root.endsWith("/") || root.endsWith("\\") ? `${root}${name}` : `${root}/${name}`;
}
function recordOf(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null ? value as Record<string, unknown> : {};
}
function normalizeConfig(value: unknown): PetConfig {
  const raw = recordOf(value);
  const fps: MaxFpsOption = raw.maxFps === 0 || raw.maxFps === 60 ? raw.maxFps : 30;
  const rawSize = typeof raw.size === "number" ? raw.size : Number(raw.size);
  const size = Number.isFinite(rawSize) ? Math.min(400, Math.max(40, rawSize)) : DEFAULT_CONFIG.size;
  return {
    enabled: raw.enabled !== false,
    size,
    maxFps: fps,
    model: typeof raw.model === "string" && raw.model.trim() ? raw.model.trim() : DEFAULT_CONFIG.model,
    developerMode: raw.developerMode === true,
    debug: raw.debug === true,
    showTapZones: raw.showTapZones === true,
    persona: typeof raw.persona === "string" && raw.persona.trim() ? raw.persona.trim() : DEFAULT_CONFIG.persona,
    keepAnimatingWhenInactive: raw.keepAnimatingWhenInactive === true,
  };
}
function isTerminal(event: AfterTurnEvent): boolean {
  return event.status === "completed" || event.status === "cancelled" || event.status === "failed";
}
function normalizeRelativePath(value: string): string {
  return value.trim().replaceAll("\\", "/").replace(/^\/+/, "");
}

function isFatalDocumentParseError(error: string | null): boolean {
  return error?.startsWith("JSONC 解析失败") === true || error?.startsWith("JSONC 结构错误") === true;
}

export class PetRuntime {
  private config: PetConfig = { ...DEFAULT_CONFIG };
  private display: PetDisplay = { ...DEFAULT_DISPLAY };
  private state: PetState = "idle";
  private agent = "idle";
  /** 当前激活会话：只有它的回合驱动桌宠表现（spec §3）。 */
  private activeSession: SessionRef | null = null;
  private readonly turns: TrackedTurn[] = [];
  /** 已到终态/已释放的回合 id（`engine\u0000turnId`，插入序）：区分「本 runtime 没见过的回合」
   *  与「已经结算过的回合」，前者要补表现，后者的迟到事件必须继续忽略。 */
  private readonly retiredTurns = new Set<string>();
  private version = 0;
  private readyState = false;
  private readonly listeners = new Set<Listener>();
  private readonly disposers: Disposer[] = [];
  private customModels: CustomModelEntry[] = [];
  private customModelsError: string | null = null;
  private customPersonas: CustomPersonaDef[] = [];
  private personasError: string | null = null;
  private documentRoot = "";
  private lastModelsVersion: string | null = null;
  private lastPersonasVersion: string | null = null;
  readonly ready: Promise<void>;

  constructor(private readonly ctx: PluginContext) {
    this.ready = this.initialize();
    const sessionHooks: SessionHooks = {
      onCreated: (event) => {
        // 首轮开始后宿主才返回 native ID：只补齐会话身份，不打断当前表现。
        const pending = this.findTurn({ engine: event.engine, sessionId: null, workspacePath: event.workspace.path });
        if (pending && !pending.sessionId) pending.sessionId = event.sessionId;
        const active = this.activeSession;
        if (active && !active.sessionId && active.engine === event.engine && (active.workspacePath ?? "") === event.workspace.path) {
          active.sessionId = event.sessionId;
        }
        this.refresh();
      },
      onRestored: (event) => {
        // 恢复/切换会话只改变「表现哪一个会话」，被切走的回合继续在后台跟踪。
        this.activeSession = { engine: event.engine, sessionId: event.sessionId, workspacePath: event.workspace.path };
        this.refresh();
      },
      onClosed: (event) => {
        const ref: SessionRef = { engine: event.engine, sessionId: event.sessionId, workspacePath: event.workspace.path };
        const turn = this.findTurn(ref);
        if (turn) this.dropTurn(turn);
        const active = this.activeSession;
        if (active && this.matchesSession(active, ref)) this.activeSession = null;
        this.refresh();
      },
    };
    const turnHooks: TurnHooks = {
      onTurnStarted: (event) => {
        const ref: SessionRef = { engine: event.engine, sessionId: event.sessionId, workspacePath: event.workspace.path };
        // 宿主未报告激活会话时跟随本回合；后台会话的回合只记录，不改当前表现。
        const active = this.activeSession;
        if (!active || this.matchesSession(active, ref)) {
          this.activeSession = ref;
          this.agent = event.engine;
        }
        this.upsertTurn(ref, event.turnId, "thinking");
        this.refresh();
      },
      onRuntimeEvent: (event) => this.onRuntimeEvent(event),
      afterTurn: (event) => this.afterTurn(event),
    };
    this.disposers.push(ctx.hooks.registerSessionHooks(sessionHooks));
    this.disposers.push(ctx.hooks.registerTurnHooks(turnHooks));
    // 宿主唯一的「激活会话变化」信号：切标签页/切会话/新建会话都会发射。
    this.disposers.push(ctx.events.on(SESSION_ACTIVATED_TOPIC, (data) => this.onSessionActivated(data)));
  }

  private async initialize(): Promise<void> {
    const [storedConfig, storedDisplay, location] = await Promise.all([
      this.ctx.storage.get<unknown>(CONFIG_KEY),
      this.ctx.storage.get<unknown>(DISPLAY_KEY),
      this.ctx.documentStorage.getLocation(),
    ]);
    this.config = normalizeConfig(storedConfig);
    this.display = normalizeDisplay(recordOf(storedDisplay) as Partial<PetDisplay>);
    this.documentRoot = location.path;
    await Promise.all([this.loadPersonasInternal(), this.loadCustomModelsInternal()]);
    this.readyState = true;
    this.emit();
  }

  /** 会话匹配：两端都有 native ID 时按 ID + 引擎（双方都带工作区时还要一致）；
   *  pending 侧按引擎 + 工作区匹配。 */
  private matchesSession(
    candidate: { engine: string; sessionId: string | null; workspacePath?: string },
    ref: { engine: string; sessionId: string | null; workspacePath?: string },
  ): boolean {
    if (candidate.engine !== ref.engine) return false;
    if (candidate.sessionId && ref.sessionId) {
      if (candidate.sessionId !== ref.sessionId) return false;
      const left = candidate.workspacePath;
      const right = ref.workspacePath;
      return !left || !right || left === right;
    }
    const path = ref.workspacePath ?? candidate.workspacePath;
    return !!path && candidate.workspacePath === path;
  }

  private findTurn(ref: SessionRef): TrackedTurn | undefined {
    return this.turns.find((turn) => this.matchesSession(turn, ref));
  }

  /** 回合内事件按 `turnId` 定位：宿主可以在回合中途改写 native session id
   *  （`engine-events.ts` 的 `onSession` 无条件改写，且不发 `session://activated`），
   *  此时只有 `turnId` 还稳定。命中后把新 id 落到跟踪记录与激活引用上，
   *  否则后续事件与表现都会按旧身份失配。 */
  private findTurnForEvent(ref: SessionRef, turnId: string): TrackedTurn | undefined {
    const byTurn = this.turns.find((turn) => turn.turnId === turnId && turn.engine === ref.engine);
    if (byTurn) {
      this.adoptSessionId(byTurn, ref.sessionId);
      return byTurn;
    }
    // 回退到会话匹配只对「还没结算的回合」有效：已结算的记录（done 保持中、error 等下一回合）
    // 仍留在列表里，若让它接住一个新的 turnId，新回合会被当成迟到事件丢弃。
    const bySession = this.findTurn(ref);
    if (bySession && (!bySession.turnId || bySession.turnId === turnId)) return bySession;
    return undefined;
  }

  /** 把宿主改写后的 native session id 同步到跟踪记录；激活引用指向同一会话时一并跟进。 */
  private adoptSessionId(turn: TrackedTurn, sessionId: string | null): void {
    if (!sessionId || turn.sessionId === sessionId) return;
    const previous = turn.sessionId;
    const active = this.activeSession;
    turn.sessionId = sessionId;
    if (active && active.engine === turn.engine && (active.sessionId ?? null) === previous) {
      active.sessionId = sessionId;
    }
  }

  private upsertTurn(ref: SessionRef, turnId: string, state: PetState): TrackedTurn {
    const existing = this.findTurn(ref);
    if (existing) {
      this.clearTurnTimer(existing);
      existing.turnId = turnId;
      existing.state = state;
      if (!existing.sessionId && ref.sessionId) existing.sessionId = ref.sessionId;
      return existing;
    }
    const turn: TrackedTurn = {
      engine: ref.engine,
      sessionId: ref.sessionId,
      workspacePath: ref.workspacePath ?? "",
      turnId,
      state,
    };
    // 不设数量上限：任何会话的回合都要保留到终态/会话关闭，切回时才能立刻恢复反馈。
    this.turns.push(turn);
    return turn;
  }

  private dropTurn(turn: TrackedTurn): void {
    this.clearTurnTimer(turn);
    this.retireTurn(turn);
    const index = this.turns.indexOf(turn);
    if (index >= 0) this.turns.splice(index, 1);
  }

  /** 记下回合 id 已结算；超出上限时按插入序淘汰最旧的一条。 */
  private retireTurn(turn: TrackedTurn): void {
    if (!turn.turnId) return;
    const key = `${turn.engine}\u0000${turn.turnId}`;
    this.retiredTurns.delete(key);
    this.retiredTurns.add(key);
    while (this.retiredTurns.size > RETIRED_TURNS_LIMIT) {
      const oldest = this.retiredTurns.values().next();
      if (oldest.done) break;
      this.retiredTurns.delete(oldest.value);
    }
  }

  private clearTurnTimer(turn: TrackedTurn): void {
    if (turn.timer !== undefined) {
      clearTimeout(turn.timer);
      turn.timer = undefined;
    }
  }

  /** 当前表现 = 激活会话的跟踪回合状态；没有跟踪回合即 idle（spec §3）。 */
  private presentedState(): PetState {
    const active = this.activeSession;
    if (!active) return "idle";
    return this.findTurn(active)?.state ?? "idle";
  }

  private refresh(): void {
    const next = this.presentedState();
    if (next === this.state) return;
    this.state = next;
    this.version += 1;
    this.emit();
  }

  private onSessionActivated(data: unknown): void {
    const payload = recordOf(data);
    const engine = typeof payload.engine === "string" && payload.engine ? payload.engine : null;
    const sessionId = typeof payload.sessionId === "string" && payload.sessionId ? payload.sessionId : null;
    // pending 标签页与「无标签页」都不对应任何跟踪中的回合 → 表现 idle。
    this.activeSession = engine && sessionId ? { engine, sessionId } : null;
    this.refresh();
  }

  /** 完成态保持 DONE_HOLD_MS 后释放该会话的回合；新回合会立即取消保持计时。 */
  private holdDone(turn: TrackedTurn): void {
    this.clearTurnTimer(turn);
    turn.state = "done";
    turn.timer = setTimeout(() => {
      turn.timer = undefined;
      this.dropTurn(turn);
      this.refresh();
    }, DONE_HOLD_MS);
    this.refresh();
  }

  private onRuntimeEvent(event: NormalizedRuntimeEvent): void {
    const turn = this.findTurnForEvent(
      { engine: event.engine, sessionId: event.sessionId, workspacePath: event.workspacePath },
      event.turnId,
    );
    if (!turn || !turn.turnId || turn.turnId !== event.turnId) return;
    if (event.kind === "permission-requested") turn.state = "waiting";
    else if (event.kind === "assistant-completed") { this.holdDone(turn); return; }
    else if (event.kind === "turn-cancelled") this.dropTurn(turn);
    else if (event.kind === "turn-failed") { this.retireTurn(turn); turn.state = "error"; turn.turnId = null; }
    else if (event.kind === "runtime-exited" && turn.state !== "done") this.dropTurn(turn);
    else return;
    this.refresh();
  }
  private afterTurn(event: AfterTurnEvent): void {
    if (!isTerminal(event)) return;
    const ref: SessionRef = { engine: event.engine, sessionId: event.sessionId, workspacePath: event.workspace.path };
    const turn = this.findTurnForEvent(ref, event.turnId);
    if (!turn) {
      // 已结算过的回合：迟到事件不得复活它（会话关闭、取消、运行时退出、done 保持到期都走这里）。
      if (this.retiredTurns.has(`${event.engine}\u0000${event.turnId}`)) return;
      // 本 runtime 没见过这个回合（插件热重载/重新启用/overlay 换了新 runtime）：
      // 仍要表现终态，否则完成与失败被静默丢弃、永远停在 idle。
      // 取消没有可表现的反馈，照旧忽略。
      if (event.status === "cancelled") return;
      const adopted = this.upsertTurn(ref, event.turnId, "thinking");
      const active = this.activeSession;
      if (!active || this.matchesSession(active, ref)) {
        this.activeSession = ref;
        this.agent = event.engine;
      }
      this.settleTurn(adopted, event.status);
      return;
    }
    if (!turn.turnId || turn.turnId !== event.turnId) return;
    this.settleTurn(turn, event.status);
  }

  /** 终态落盘：完成保持 DONE_HOLD_MS，失败停在 error 等下一回合，取消直接释放。 */
  private settleTurn(turn: TrackedTurn, status: AfterTurnEvent["status"]): void {
    if (status === "completed") { this.holdDone(turn); return; }
    if (status === "failed") { this.retireTurn(turn); turn.state = "error"; turn.turnId = null; }
    else this.dropTurn(turn);
    this.refresh();
  }
  private emit(): void {
    const view = this.snapshot();
    for (const listener of [...this.listeners]) listener(view);
  }
  subscribe(listener: Listener): Disposer {
    this.listeners.add(listener);
    return () => { this.listeners.delete(listener); };
  }

  snapshot(): PetStateView {
    const rawModel = resolveModelLocation(this.config.model, this.customModels);
    const custom = this.customModels.find((entry) => entry.id === this.config.model);
    let modelUrl: string | null = null;
    try {
      if (custom?.directoryGrantId && custom.directoryPath) {
        modelUrl = this.ctx.assets.directoryUrl(custom.directoryGrantId, normalizeRelativePath(custom.directoryPath));
      } else if (rawModel && /^https?:\/\//i.test(rawModel)) {
        modelUrl = this.ctx.assets.remoteUrl(rawModel);
      }
    } catch {
      modelUrl = null;
    }
    return {
      state: this.state,
      agent: this.agent,
      config: {
        ...this.config,
        modelUrl,
        spatialTap: resolveSpatialTap(this.config.model, this.customModels),
        motionMap: resolveMotionMap(this.config.model, this.customModels),
      },
      display: { ...this.display },
      customModels: this.customModels.map((entry) => ({ ...entry })),
      customModelsError: this.customModelsError,
      customPersonas: this.customPersonas.map((entry) => ({ ...entry })),
      personasError: this.personasError,
      personasFile: childPath(this.documentRoot, PERSONAS_FILE),
      customModelsFile: childPath(this.documentRoot, CUSTOM_MODELS_FILE),
      version: this.version,
    };
  }
  async waitUntilReady(): Promise<void> { await this.ready; }
  isReady(): boolean { return this.readyState; }

  async setSettings(ops: readonly SettingsOp[]): Promise<PetStateView> {
    await this.ready;
    const next: Record<string, unknown> = { ...this.config };
    for (const operation of ops) {
      const key = operation.path.length === 1 ? operation.path[0] : undefined;
      if (!key || !CONFIG_KEYS.includes(key as keyof PetConfig)) continue;
      if (operation.op === "unset") delete next[key];
      else next[key] = operation.value;
    }
    this.config = normalizeConfig(next);
    await this.ctx.storage.set(CONFIG_KEY, this.config);
    this.version += 1;
    this.emit();
    return this.snapshot();
  }
  async settingsView(): Promise<{ value: PetConfig; writable: boolean }> {
    await this.ready;
    return { value: { ...this.config }, writable: true };
  }

  private async readOrCreate(relativePath: string, fallback: string): Promise<{ content: string; version: string }> {
    const current = await this.ctx.documentStorage.readText(relativePath);
    if (current) return current;
    const written = await this.ctx.documentStorage.writeTextAtomic(relativePath, fallback, null);
    return { content: fallback, version: written.version };
  }
  private async loadPersonasInternal(): Promise<PersonasFileView> {
    const path = childPath(this.documentRoot, PERSONAS_FILE);
    try {
      const current = await this.readOrCreate(PERSONAS_FILE, PERSONAS_TEMPLATE);
      if (current.version === this.lastPersonasVersion) return { personas: this.customPersonas, error: this.personasError, path };
      const parsed = parsePersonas(current.content, path);
      this.lastPersonasVersion = current.version;
      if (isFatalDocumentParseError(parsed.error)) {
        this.personasError = parsed.error;
        return { personas: this.customPersonas, error: this.personasError, path };
      }
      this.customPersonas = parsed.personas;
      this.personasError = parsed.error;
      return parsed;
    } catch (error) {
      this.personasError = `无法读取人设文件：${error instanceof Error ? error.message : String(error)}`;
      return { personas: this.customPersonas, error: this.personasError, path };
    }
  }
  private async loadCustomModelsInternal(): Promise<CustomModelsFileView> {
    const path = childPath(this.documentRoot, CUSTOM_MODELS_FILE);
    try {
      const current = await this.readOrCreate(CUSTOM_MODELS_FILE, serializeCustomModels([]));
      if (current.version === this.lastModelsVersion) return { models: this.customModels, error: this.customModelsError, path };
      const parsed = parseCustomModels(current.content);
      this.lastModelsVersion = current.version;
      if (isFatalDocumentParseError(parsed.error)) {
        this.customModelsError = parsed.error;
        return { models: this.customModels, error: this.customModelsError, path };
      }
      this.customModels = parsed.models;
      this.customModelsError = parsed.error;
      return { ...parsed, path };
    } catch (error) {
      this.customModelsError = `无法读取模型文件：${error instanceof Error ? error.message : String(error)}`;
      return { models: this.customModels, error: this.customModelsError, path };
    }
  }
  async loadPersonas(): Promise<PersonasFileView> {
    await this.ready;
    return this.loadPersonasInternal();
  }
  async reloadPersonas(): Promise<PersonasFileView> {
    await this.ready;
    this.lastPersonasVersion = null;
    const view = await this.loadPersonasInternal();
    this.version += 1;
    this.emit();
    return view;
  }

  async loadCustomModels(): Promise<CustomModelsFileView> {
    await this.ready;
    return this.loadCustomModelsInternal();
  }
  async saveCustomModels(models: readonly CustomModelEntry[]): Promise<CustomModelsFileView> {
    await this.ready;
    const path = childPath(this.documentRoot, CUSTOM_MODELS_FILE);
    const content = serializeCustomModels(models);
    try {
      let current = await this.ctx.documentStorage.readText(CUSTOM_MODELS_FILE);
      let result: { version: string };
      try {
        result = await this.ctx.documentStorage.writeTextAtomic(CUSTOM_MODELS_FILE, content, current?.version ?? null);
      } catch {
        current = await this.ctx.documentStorage.readText(CUSTOM_MODELS_FILE);
        result = await this.ctx.documentStorage.writeTextAtomic(CUSTOM_MODELS_FILE, content, current?.version ?? null);
      }
      this.customModels = parseCustomModels(content).models;
      this.customModelsError = null;
      this.lastModelsVersion = result.version;
      this.version += 1;
      this.emit();
      return { models: this.customModels, error: null, path };
    } catch (error) {
      this.customModelsError = `写入失败：${error instanceof Error ? error.message : String(error)}`;
      return { models: this.customModels, error: this.customModelsError, path };
    }
  }

  listBuiltinPresets() { return listBuiltinPresets(); }
  bundleAssetUrl(relativePath: string): string { return this.ctx.assets.bundleUrl(relativePath); }
  async setDisplay(patch: Partial<PetDisplay>): Promise<PetDisplay> {
    await this.ready;
    this.display = normalizeDisplay({ ...this.display, ...patch });
    await this.ctx.storage.set(DISPLAY_KEY, this.display);
    this.version += 1;
    this.emit();
    return { ...this.display };
  }
  async resetDisplay(): Promise<PetDisplay> { return this.setDisplay(DEFAULT_DISPLAY); }
  async grantDirectory(): Promise<AssetDirectoryGrant> { return this.ctx.assets.grantDirectory(); }

  modelAssetUrl(entry: CustomModelEntry | string): string {
    const model = typeof entry === "string" ? this.customModels.find((candidate) => candidate.id === entry) : entry;
    if (model?.directoryGrantId && model.directoryPath) {
      return this.ctx.assets.directoryUrl(model.directoryGrantId, normalizeRelativePath(model.directoryPath));
    }
    const location = typeof entry === "string" ? entry : entry.modelUrl;
    if (!/^https?:\/\//i.test(location.trim())) throw new Error("本地模型请先选择授权目录");
    return this.ctx.assets.remoteUrl(location.trim());
  }
  async fetchMotionGroups(entry: CustomModelEntry | string): Promise<string[]> {
    const response = await fetch(this.modelAssetUrl(entry));
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    return Object.keys(modelMotionDefinitions(await response.json()));
  }
  async revealPath(path: string): Promise<boolean> {
    try {
      await this.ctx.shell.revealPath(path);
      return true;
    } catch {
      return false;
    }
  }
  async revealDocument(relativePath: string): Promise<boolean> {
    return this.revealPath(childPath(this.documentRoot, relativePath));
  }
  async documentLocation(): Promise<string> { await this.ready; return this.documentRoot; }
  dispose(): void {
    for (const turn of this.turns) this.clearTurnTimer(turn);
    this.turns.length = 0;
    for (const dispose of this.disposers.splice(0).reverse()) dispose();
    this.listeners.clear();
  }
}
