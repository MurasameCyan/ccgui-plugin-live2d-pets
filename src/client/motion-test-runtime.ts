import { vi } from "vitest";

/** Keep PLD's real reservation/start/finish machinery; replace only asset loading and the native queue. */
export async function createMotionTestRuntime(groups: readonly string[]) {
  // The common manager ships in the Cubism 2 entrypoint. These unused Core
  // constructors only satisfy that entrypoint's registration-time checks.
  vi.stubGlobal("Live2D", {});
  vi.stubGlobal("Live2DMotion", class { updateParam() {} });
  vi.stubGlobal("AMotion", class {});
  vi.stubGlobal("PhysicsHair", { Src: { SRC_TO_X: 0, SRC_TO_Y: 1, SRC_TO_G_ANGLE: 2 } });
  const { MotionManager, Cubism2ModelSettings, MotionPreloadStrategy } = await import("pixi-live2d-display/cubism2");
  type Motion = { file: string };
  const definitions = Object.fromEntries(groups.map((group) => [group, [{ file: `${group}.mtn` }]]));

  class TestMotionManager extends MotionManager<Motion, Motion> {
    readonly definitions = definitions;
    readonly groups = { idle: "Idle" };
    readonly motionDataType = "arraybuffer" as const;
    expressionManager = undefined;
    private queued = false;
    private loads = new Map<string, Promise<void>>();

    constructor() {
      super(new Cubism2ModelSettings({
        url: "https://motion.test/model.json", model: "model.moc", textures: ["texture.png"], motions: definitions,
      }));
      this.init({ motionPreload: MotionPreloadStrategy.NONE });
    }

    hold(group: string) {
      let resolve!: () => void;
      let reject!: (error: Error) => void;
      this.loads.set(group, new Promise<void>((done, fail) => { resolve = done; reject = fail; }));
      return { resolve, reject };
    }

    override async loadMotion(group: string, index: number) {
      const load = this.loads.get(group);
      if (load) await load;
      return this.definitions[group]?.[index];
    }

    isFinished() { return !this.queued; }
    createMotion(_data: unknown, _group: string, definition: Motion) { return definition; }
    getMotionFile(definition: Motion) { return definition.file; }
    protected getMotionName(definition: Motion) { return definition.file; }
    protected getSoundFile() { return undefined; }
    protected _startMotion() { this.queued = true; return 1; }
    protected _stopAllMotions() { this.queued = false; }
    protected updateParameters() { return this.queued; }

    frame() { this.update({}, 0); }
    finish() { this.queued = false; this.frame(); }
  }

  return new TestMotionManager();
}
