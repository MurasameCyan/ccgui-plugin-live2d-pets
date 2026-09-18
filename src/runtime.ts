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
};
const CONFIG_KEYS: readonly (keyof PetConfig)[] = [
  "enabled", "size", "maxFps", "model", "developerMode", "debug", "showTapZones", "persona",
];
const DONE_HOLD_MS = 3500;
const PERSONAS_FILE = "personas.jsonc";
const CUSTOM_MODELS_FILE = "custom-models.jsonc";
const DISPLAY_KEY = "display";
const CONFIG_KEY = "config";

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
  private activeTurnId: string | undefined;
  private doneTimer: ReturnType<typeof setTimeout> | undefined;
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
      onCreated: () => this.setState("idle"),
      onRestored: () => this.setState("idle"),
      onClosed: () => { this.activeTurnId = undefined; this.setState("idle"); },
    };
    const turnHooks: TurnHooks = {
      onTurnStarted: (event) => {
        this.activeTurnId = event.turnId;
        this.agent = event.engine;
        this.setState("thinking");
      },
      onRuntimeEvent: (event) => this.onRuntimeEvent(event),
      afterTurn: (event) => this.afterTurn(event),
    };
    this.disposers.push(ctx.hooks.registerSessionHooks(sessionHooks));
    this.disposers.push(ctx.hooks.registerTurnHooks(turnHooks));
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

  private setState(next: PetState): void {
    if (this.doneTimer !== undefined) {
      clearTimeout(this.doneTimer);
      this.doneTimer = undefined;
    }
    if (this.state === next) return;
    this.state = next;
    this.version += 1;
    this.emit();
  }
  private setDone(): void {
    this.setState("done");
    this.doneTimer = setTimeout(() => {
      this.doneTimer = undefined;
      this.activeTurnId = undefined;
      this.setState("idle");
    }, DONE_HOLD_MS);
  }
  private onRuntimeEvent(event: NormalizedRuntimeEvent): void {
    if (this.activeTurnId && event.turnId !== this.activeTurnId) return;
    if (event.kind === "permission-requested") this.setState("waiting");
    else if (event.kind === "assistant-completed") this.setDone();
    else if (event.kind === "turn-cancelled") { this.activeTurnId = undefined; this.setState("idle"); }
    else if (event.kind === "turn-failed") { this.activeTurnId = undefined; this.setState("error"); }
    else if (event.kind === "runtime-exited" && this.state !== "done") { this.activeTurnId = undefined; this.setState("idle"); }
  }
  private afterTurn(event: AfterTurnEvent): void {
    if (!isTerminal(event) || (this.activeTurnId && event.turnId !== this.activeTurnId)) return;
    if (event.status === "completed") this.setDone();
    else if (event.status === "failed") { this.activeTurnId = undefined; this.setState("error"); }
    else { this.activeTurnId = undefined; this.setState("idle"); }
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
    const data = recordOf(await response.json());
    const fileReferences = recordOf(data.FileReferences);
    const motions = recordOf(fileReferences.Motions ?? data.Motions);
    return Object.keys(motions);
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
    clearTimeout(this.doneTimer);
    this.doneTimer = undefined;
    for (const dispose of this.disposers.splice(0).reverse()) dispose();
    this.listeners.clear();
  }
}
