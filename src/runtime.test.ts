import { afterEach, describe, expect, it, vi } from "vitest";
import { PetRuntime } from "./runtime";
import { makeContext, turnEvent } from "./test-context";
import type { NormalizedRuntimeEvent } from "./sdk";

function runtimeEvent(kind: "permission-requested" | "turn-cancelled" | "turn-failed" | "runtime-exited"): NormalizedRuntimeEvent {
  return {
    ...turnEvent(), kind, eventId: `event-${kind}`, workspaceId: "workspace-1", workspacePath: "C:/work",
    tool: null, path: null, exitCode: 0,
  } as NormalizedRuntimeEvent;
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

  it("keeps the debug panel position independent across pet moves, reset and reload", async () => {
    const { ctx } = makeContext();
    const runtime = new PetRuntime(ctx);
    await runtime.waitUntilReady();
    try {
      await runtime.setDisplay({ right: 110, bottom: 70 });
      await runtime.setDisplay({ debugPosition: { left: 280, top: 160 } });
      expect(runtime.snapshot().display).toMatchObject({
        right: 110, bottom: 70, debugPosition: { left: 280, top: 160 },
      });
      await runtime.setDisplay({ right: 80, bottom: 100 });
      await runtime.resetDisplay();
    } finally {
      runtime.dispose();
    }
    const restored = new PetRuntime(ctx);
    await restored.waitUntilReady();
    try {
      expect(restored.snapshot().display.debugPosition).toEqual({ left: 280, top: 160 });
    } finally {
      restored.dispose();
    }
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

  for (const phase of ["closed", "cancelled", "failed", "exited", "expired"] as const) {
    it.each(["runtime", "afterTurn"] as const)(`ignores late %s callbacks for an already settled turn (${phase})`, async (source) => {
      vi.useFakeTimers();
      const harness = makeContext();
      const runtime = new PetRuntime(harness.ctx);
      try {
        await runtime.ready;
        const hooks = harness.getTurnHooks()!;
        hooks.onTurnStarted?.(turnEvent());
        if (phase === "closed") harness.getSessionHooks()?.onClosed?.(turnEvent());
        if (phase === "cancelled") hooks.onRuntimeEvent?.(runtimeEvent("turn-cancelled"));
        if (phase === "failed") hooks.onRuntimeEvent?.(runtimeEvent("turn-failed"));
        if (phase === "exited") hooks.onRuntimeEvent?.(runtimeEvent("runtime-exited"));
        if (phase === "expired") {
          hooks.afterTurn?.({ ...turnEvent(), status: "completed" });
          vi.advanceTimersByTime(3500);
        }
        const expected = phase === "failed" ? "error" : "idle";
        expect(runtime.snapshot().state).toBe(expected);
        if (source === "runtime") hooks.onRuntimeEvent?.(runtimeEvent("permission-requested"));
        else hooks.afterTurn?.({ ...turnEvent(), status: "completed" });
        expect(runtime.snapshot().state).toBe(expected);
        expect(vi.getTimerCount()).toBe(0);

        hooks.onTurnStarted?.({ ...turnEvent(), turnId: "next-turn" });
        expect(runtime.snapshot().state).toBe("thinking");
      } finally {
        runtime.dispose();
      }
    });
  }

  it("ignores a runtime event for a turn it never saw start", async () => {
    vi.useFakeTimers();
    const harness = makeContext();
    const runtime = new PetRuntime(harness.ctx);
    try {
      await runtime.ready;
      // 回合内进度事件不是终态，没有跟踪记录时无从判断该表现什么 → 保持 idle。
      harness.getTurnHooks()?.onRuntimeEvent?.(runtimeEvent("permission-requested"));
      expect(runtime.snapshot().state).toBe("idle");
      expect(vi.getTimerCount()).toBe(0);

      harness.getTurnHooks()?.onTurnStarted?.({ ...turnEvent(), turnId: "next-turn" });
      expect(runtime.snapshot().state).toBe("thinking");
    } finally {
      runtime.dispose();
    }
  });

  it("keeps the first turn active when the host announces its native session ID after turn start", async () => {
    const harness = makeContext();
    const runtime = new PetRuntime(harness.ctx);
    try {
      await runtime.ready;
      harness.getTurnHooks()?.onTurnStarted?.({ ...turnEvent(), sessionId: null });
      harness.getSessionHooks()?.onCreated?.(turnEvent());
      expect(runtime.snapshot().state).toBe("thinking");
      harness.getTurnHooks()?.onRuntimeEvent?.(runtimeEvent("permission-requested"));
      expect(runtime.snapshot().state).toBe("waiting");
      harness.getSessionHooks()?.onClosed?.(turnEvent());
      expect(runtime.snapshot().state).toBe("idle");
      harness.getTurnHooks()?.afterTurn?.({ ...turnEvent(), status: "completed" });
      expect(runtime.snapshot().state).toBe("idle");
    } finally {
      runtime.dispose();
    }
  });

  it("invalidates the previous turn when restoring a different session", async () => {
    const harness = makeContext();
    const runtime = new PetRuntime(harness.ctx);
    try {
      await runtime.ready;
      harness.getTurnHooks()?.onTurnStarted?.(turnEvent());
      harness.getSessionHooks()?.onRestored?.({ ...turnEvent(), sessionId: "other-session" });
      expect(runtime.snapshot().state).toBe("idle");
      harness.getTurnHooks()?.afterTurn?.({ ...turnEvent(), status: "completed" });
      expect(runtime.snapshot().state).toBe("idle");
      harness.getTurnHooks()?.onTurnStarted?.({ ...turnEvent(), turnId: "next-turn", sessionId: "other-session" });
      expect(runtime.snapshot().state).toBe("thinking");
    } finally {
      runtime.dispose();
    }
  });

  it("keeps a running turn when that same session is restored", async () => {
    const harness = makeContext();
    const runtime = new PetRuntime(harness.ctx);
    try {
      await runtime.ready;
      harness.getTurnHooks()?.onTurnStarted?.(turnEvent());
      harness.getSessionHooks()?.onRestored?.(turnEvent());
      expect(runtime.snapshot().state).toBe("thinking");
      harness.getTurnHooks()?.afterTurn?.({ ...turnEvent(), status: "completed" });
      expect(runtime.snapshot().state).toBe("done");
    } finally {
      runtime.dispose();
    }
  });

  it("keeps mirroring a turn after switching to another session and back", async () => {
    const harness = makeContext();
    const runtime = new PetRuntime(harness.ctx);
    try {
      await runtime.ready;
      const hooks = harness.getTurnHooks()!;
      hooks.onTurnStarted?.(turnEvent());
      expect(runtime.snapshot().state).toBe("thinking");

      // 切到另一个会话：桌宠不再表现旧会话的回合，但该回合仍在继续跟踪。
      harness.emit("session://activated", { engine: "codex", sessionId: "other-session" });
      expect(runtime.snapshot().state).toBe("idle");
      hooks.onRuntimeEvent?.(runtimeEvent("permission-requested"));
      expect(runtime.snapshot().state).toBe("idle");

      // 切回原会话：仍在运行的回合立刻恢复表现，不再永久丢失反馈。
      harness.emit("session://activated", { engine: "codex", sessionId: "session-1" });
      expect(runtime.snapshot().state).toBe("waiting");
    } finally {
      runtime.dispose();
    }
  });

  it("keeps a background session's turn from driving the pet while another session is active", async () => {
    const harness = makeContext();
    const runtime = new PetRuntime(harness.ctx);
    try {
      await runtime.ready;
      harness.emit("session://activated", { engine: "codex", sessionId: "session-1" });
      expect(runtime.snapshot().state).toBe("idle");

      // 后台会话开始回合：记录在案，但不改变当前会话的表现。
      harness.getTurnHooks()?.onTurnStarted?.({ ...turnEvent(), sessionId: "session-2", turnId: "turn-2" });
      expect(runtime.snapshot().state).toBe("idle");

      // 切到该会话才表现它的回合。
      harness.emit("session://activated", { engine: "codex", sessionId: "session-2" });
      expect(runtime.snapshot().state).toBe("thinking");
    } finally {
      runtime.dispose();
    }
  });

  it("tracks turns for every session without evicting older ones", async () => {
    const harness = makeContext();
    const runtime = new PetRuntime(harness.ctx);
    try {
      await runtime.ready;
      const hooks = harness.getTurnHooks()!;
      const sessionIds = Array.from({ length: 10 }, (_, index) => `session-${index + 1}`);
      for (const sessionId of sessionIds) {
        hooks.onTurnStarted?.({ ...turnEvent(), sessionId, turnId: `turn-${sessionId}` });
      }

      // 早期会话的回合必须仍然在跟踪：切回去要能立刻恢复实时状态
      harness.emit("session://activated", { engine: "codex", sessionId: "session-1" });
      expect(runtime.snapshot().state).toBe("thinking");
      hooks.onRuntimeEvent?.({
        ...turnEvent(),
        sessionId: "session-1",
        turnId: "turn-session-1",
        eventId: "permission",
        workspaceId: "workspace-1",
        workspacePath: "C:/work",
        kind: "permission-requested",
        tool: "shell",
        path: null,
      });
      expect(runtime.snapshot().state).toBe("waiting");

      // 最新会话同样保留
      harness.emit("session://activated", { engine: "codex", sessionId: "session-10" });
      expect(runtime.snapshot().state).toBe("thinking");
    } finally {
      runtime.dispose();
    }
  });

  it.each([
    { sessionId: "other-session" },
    { engine: "claude" },
    { workspace: { id: "workspace-2", path: "D:/other" } },
  ])("ignores a different session's close signal (%j)", async (difference) => {
    const harness = makeContext();
    const runtime = new PetRuntime(harness.ctx);
    try {
      await runtime.ready;
      harness.getTurnHooks()?.onTurnStarted?.(turnEvent());
      harness.getSessionHooks()?.onClosed?.({ ...turnEvent(), ...difference });
      expect(runtime.snapshot().state).toBe("thinking");
    } finally {
      runtime.dispose();
    }
  });

  it("settles a turn whose native session ID is rekeyed mid-turn", async () => {
    const harness = makeContext();
    const runtime = new PetRuntime(harness.ctx);
    try {
      await runtime.ready;
      harness.emit("session://activated", { engine: "codex", sessionId: "session-1" });
      harness.getTurnHooks()?.onTurnStarted?.(turnEvent());
      expect(runtime.snapshot().state).toBe("thinking");

      // 宿主在回合中途把 native session id 换掉（engine-events.ts 无条件改写 lifecycle.sessionId），
      // 没有任何 session://activated 对账；完成事件带的是新 id。
      harness.getTurnHooks()?.onRuntimeEvent?.({
        ...runtimeEvent("permission-requested"), sessionId: "session-rekeyed",
      });
      expect(runtime.snapshot().state).toBe("waiting");
      harness.getTurnHooks()?.afterTurn?.({ ...turnEvent(), sessionId: "session-rekeyed", status: "completed" });
      expect(runtime.snapshot().state).toBe("done");
    } finally {
      runtime.dispose();
    }
  });

  it("adopts a terminal turn that started before this runtime existed", async () => {
    vi.useFakeTimers();
    const harness = makeContext();
    const runtime = new PetRuntime(harness.ctx);
    try {
      await runtime.ready;
      // 插件热重载/重新启用:回合在本 runtime 之前就开始了,只收到完成事件。
      harness.getTurnHooks()?.afterTurn?.({ ...turnEvent(), status: "completed" });
      expect(runtime.snapshot().state).toBe("done");
      vi.advanceTimersByTime(3500);
      expect(runtime.snapshot().state).toBe("idle");

      // 失败同样要表现出来。
      harness.getTurnHooks()?.afterTurn?.({ ...turnEvent(), turnId: "turn-2", status: "failed" });
      expect(runtime.snapshot().state).toBe("error");
    } finally {
      runtime.dispose();
    }
  });

  it("ignores an orphan cancellation instead of inventing feedback", async () => {
    const harness = makeContext();
    const runtime = new PetRuntime(harness.ctx);
    try {
      await runtime.ready;
      harness.getTurnHooks()?.afterTurn?.({ ...turnEvent(), status: "cancelled" });
      expect(runtime.snapshot().state).toBe("idle");
    } finally {
      runtime.dispose();
    }
  });

  it("settles the next turn that arrives while the previous one is still held at done", async () => {
    vi.useFakeTimers();
    const harness = makeContext();
    const runtime = new PetRuntime(harness.ctx);
    try {
      await runtime.ready;
      harness.getTurnHooks()?.onTurnStarted?.(turnEvent());
      harness.getTurnHooks()?.afterTurn?.({ ...turnEvent(), status: "completed" });
      expect(runtime.snapshot().state).toBe("done");

      // done 仍在保持期内（计时器未到期），同一会话的下一个回合随即到达：
      // 已结算的旧记录不得接住新的 turnId，否则新回合会被当成迟到事件丢弃。
      harness.getTurnHooks()?.afterTurn?.({ ...turnEvent(), turnId: "turn-2", status: "failed" });
      expect(runtime.snapshot().state).toBe("error");
    } finally {
      runtime.dispose();
    }
  });
});
