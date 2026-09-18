export type Disposer = () => void;
export type ReactNode = unknown;
export type DocumentStorageLocationKind = "data" | "program" | "custom";

export interface WorkspaceMetadata {
  id: string;
  path: string;
  gitBranch?: string;
  gitHead?: string;
  dirty?: boolean;
}

interface SessionEventBase {
  engine: string;
  sessionId: string | null;
  workspace: WorkspaceMetadata;
  occurredAt: string;
}
export interface SessionCreatedEvent extends SessionEventBase {}
export interface SessionRestoredEvent extends SessionEventBase { sessionId: string }
export interface SessionClosedEvent extends SessionEventBase {}

interface TurnEventBase {
  runId: string;
  turnId: string;
  engine: string;
  sessionId: string | null;
  workspace: WorkspaceMetadata;
  occurredAt: string;
}
export interface BeforeTurnEvent extends TurnEventBase {}
export interface AfterTurnEvent extends TurnEventBase {
  status: "completed" | "cancelled" | "failed";
  error?: string;
}

interface NormalizedRuntimeEventBase {
  eventId: string;
  runId: string;
  turnId: string;
  engine: string;
  sessionId: string | null;
  workspaceId: string;
  workspacePath: string;
  occurredAt: string;
}
export interface FileChangedEvent extends NormalizedRuntimeEventBase {
  kind: "file-changed";
  path: string;
  change: "created" | "modified" | "deleted" | "touched";
}
export interface CommandStartedEvent extends NormalizedRuntimeEventBase {
  kind: "command-started";
  command: string;
  cwd: string;
  startedAt: string;
}
export interface CommandFinishedEvent extends NormalizedRuntimeEventBase {
  kind: "command-finished";
  command: string;
  cwd: string;
  exitCode: number | null;
  startedAt?: string;
  finishedAt: string;
  status: "completed" | "failed" | "cancelled" | "unknown";
}
export interface ToolFinishedEvent extends NormalizedRuntimeEventBase {
  kind: "tool-finished";
  toolName: string;
  status: "completed" | "failed" | "cancelled" | "unknown";
}
export interface PermissionRequestedEvent extends NormalizedRuntimeEventBase {
  kind: "permission-requested";
  tool: string | null;
  path: string | null;
}
export interface AssistantCompletedEvent extends NormalizedRuntimeEventBase { kind: "assistant-completed" }
export interface TurnCancelledEvent extends NormalizedRuntimeEventBase { kind: "turn-cancelled" }
export interface TurnFailedEvent extends NormalizedRuntimeEventBase { kind: "turn-failed"; error?: string }
export interface RuntimeExitedEvent extends NormalizedRuntimeEventBase { kind: "runtime-exited"; exitCode: number | null }
export type NormalizedRuntimeEvent =
  | FileChangedEvent
  | CommandStartedEvent
  | CommandFinishedEvent
  | ToolFinishedEvent
  | PermissionRequestedEvent
  | AssistantCompletedEvent
  | TurnCancelledEvent
  | TurnFailedEvent
  | RuntimeExitedEvent;

export interface SessionHooks {
  onCreated?(event: SessionCreatedEvent): void | Promise<void>;
  onRestored?(event: SessionRestoredEvent): void | Promise<void>;
  onClosed?(event: SessionClosedEvent): void | Promise<void>;
}
export interface TurnHooks {
  onTurnStarted?(event: BeforeTurnEvent): void | Promise<void>;
  onRuntimeEvent?(event: NormalizedRuntimeEvent): void;
  afterTurn?(event: AfterTurnEvent): void | Promise<void>;
}
export interface RuntimeSwitchHooks {
  beforeSwitch?(event: unknown): void | Promise<void>;
  afterSwitch?(event: unknown): void | Promise<void>;
}

export interface AssetDirectoryGrant { grantId: string; path: string }
export interface DocumentReadResult { content: string; version: string }
export interface DocumentStorage {
  getLocation(): Promise<{ kind: DocumentStorageLocationKind; path: string }>;
  selectLocation(kind: DocumentStorageLocationKind): Promise<{ kind: DocumentStorageLocationKind; path: string }>;
  readText(relativePath: string): Promise<DocumentReadResult | null>;
  writeTextAtomic(relativePath: string, content: string, expectedVersion: string | null): Promise<{ version: string }>;
  remove(relativePath: string, expectedVersion?: string | null): Promise<void>;
  list(prefix?: string): Promise<string[]>;
}

export interface ReactLike {
  createElement(type: unknown, props?: Record<string, unknown> | null, ...children: unknown[]): ReactNode;
  Fragment: unknown;
  useEffect(effect: () => void | (() => void), dependencies?: readonly unknown[]): void;
  useState<T>(initial: T | (() => T)): [T, (value: T | ((current: T) => T)) => void];
  useRef<T>(initial: T): { current: T };
  useCallback<T>(callback: T, dependencies: readonly unknown[]): T;
  useMemo<T>(factory: () => T, dependencies: readonly unknown[]): T;
  useSyncExternalStore<T>(subscribe: (listener: () => void) => Disposer, getSnapshot: () => T): T;
}

export type ComponentLike<P = Record<string, never>> = (props: P) => ReactNode;

export interface PluginContext {
  pluginId: string;
  version: string;
  react: ReactLike;
  hooks: {
    registerSessionHooks(hooks: SessionHooks): Disposer;
    registerTurnHooks(hooks: TurnHooks): Disposer;
    registerRuntimeSwitchHooks(hooks: RuntimeSwitchHooks): Disposer;
  };
  documentStorage: DocumentStorage;
  assets: {
    bundleUrl(relativePath: string): string;
    documentUrl(relativePath: string): string;
    remoteUrl(url: string): string;
    grantDirectory(): Promise<AssetDirectoryGrant>;
    listDirectories(): Promise<AssetDirectoryGrant[]>;
    revokeDirectory(grantId: string): Promise<void>;
    directoryUrl(grantId: string, relativePath: string): string;
  };
  shell: { revealPath(path: string): Promise<void> };
  ui: {
    registerSettingsSection(def: {
      key?: string;
      label: () => string;
      icon?: ComponentLike<{ className?: string }>;
      component: ComponentLike;
    }): Disposer;
    registerOverlay(def: { key?: string; component: ComponentLike; order?: number }): Disposer;
    registerCommand(def: { key: string; title: () => string; keywords?: () => string[]; run: () => void }): Disposer;
    openSettings?(key?: string): void;
  };
  theme: {
    injectCss(css: string): Disposer;
    setTokens(tokens: { light?: Record<string, string>; dark?: Record<string, string> }): Disposer;
  };
  i18n: { addBundle(language: string, namespace: string, resources: Record<string, unknown>): Disposer };
  storage: { get<T>(key: string): Promise<T | null>; set(key: string, value: unknown): Promise<void>; delete(key: string): Promise<void> };
  events: { on(topic: string, callback: (data: unknown) => void): Disposer; emit(topic: string, data: unknown): void };
  host: { appVersion: string; sdkVersion: string; locale: string; isWeb: boolean };
}
