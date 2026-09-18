import type { ReactLike, ReactNode } from "./sdk";

let runtime: ReactLike | undefined;

export function setReactRuntime(next: ReactLike): void {
  runtime = next;
}

export function clearReactRuntime(): void {
  runtime = undefined;
}

function react(): ReactLike {
  if (!runtime) throw new Error("Live2D Pets React runtime is not initialized");
  return runtime;
}

export function createElement(type: unknown, props?: Record<string, unknown> | null, ...children: unknown[]): ReactNode {
  return react().createElement(type, props, ...children);
}
export function fragment(): unknown { return react().Fragment; }
export function useEffect(effect: () => void | (() => void), dependencies?: readonly unknown[]): void {
  react().useEffect(effect, dependencies);
}
export function useState<T>(initial: T | (() => T)): [T, (value: T | ((current: T) => T)) => void] {
  return react().useState(initial);
}
export function useRef<T>(initial: T): { current: T } { return react().useRef(initial); }
export function useCallback<T>(callback: T, dependencies: readonly unknown[]): T {
  return react().useCallback(callback, dependencies);
}
export function useMemo<T>(factory: () => T, dependencies: readonly unknown[]): T {
  return react().useMemo(factory, dependencies);
}
export function useSyncExternalStore<T>(
  subscribe: (listener: () => void) => () => void,
  getSnapshot: () => T,
): T {
  return react().useSyncExternalStore(subscribe, getSnapshot);
}
