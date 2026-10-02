import type { CommonHitArea, CommonLayout, InternalModelOptions, MotionManagerOptions, Live2DRuntime } from 'pixi-live2d-display';
import type { Matrix } from 'pixi.js';
import { CubismFramework } from './cubism/Framework/src/live2dcubismframework';
import type { CubismIdHandle } from './cubism/Framework/src/id/cubismid';
import { CubismMoc } from './cubism/Framework/src/model/cubismmoc';
import { CubismModel } from './cubism/Framework/src/model/cubismmodel';
import { CubismMatrix44 } from './cubism/Framework/src/math/cubismmatrix44';
import { CubismMotion } from './cubism/Framework/src/motion/cubismmotion';
import { CubismMotionQueueManager } from './cubism/Framework/src/motion/cubismmotionqueuemanager';
import { CubismExpressionMotion } from './cubism/Framework/src/motion/cubismexpressionmotion';
import { CubismExpressionMotionManager } from './cubism/Framework/src/motion/cubismexpressionmotionmanager';
import { CubismBreath, BreathParameterData } from './cubism/Framework/src/effect/cubismbreath';
import { CubismEyeBlink } from './cubism/Framework/src/effect/cubismeyeblink';
import { CubismPose } from './cubism/Framework/src/effect/cubismpose';
import { CubismPhysics } from './cubism/Framework/src/physics/cubismphysics';
import { CubismWebGLOffscreenManager } from './cubism/Framework/src/rendering/cubismoffscreenmanager';
import { acquireShaders, releaseShaders, CubismGLState, isWebGL2, PixiCubismRenderer } from './cubism5-gl';
import type { ShaderLease } from './cubism5-gl';

type CommonRuntime = typeof import('pixi-live2d-display');
type PixiRuntime = typeof import('pixi.js') & { live2d: CommonRuntime };
interface MotionDefinition {
  File: string;
  Sound?: string;
  FadeInTime?: number;
  FadeOutTime?: number;
}
interface ExpressionDefinition {
  File: string;
  Name: string;
}
interface ModelJSON {
  url: string;
  FileReferences: {
    Moc: string;
    Textures: string[];
    Physics?: string;
    Pose?: string;
    Motions?: Record<string, MotionDefinition[]>;
    Expressions?: ExpressionDefinition[];
  };
  Layout?: Record<string, number>;
  HitAreas?: { Id: string; Name: string }[];
  Groups?: { Target: string; Name: string; Ids: string[] }[];
}

const encoder = new TextEncoder();
const registrations = new WeakSet<object>();
const ownedMocs = new WeakMap<CubismModel, CubismMoc>();

function jsonBuffer(data: object | ArrayBuffer): ArrayBuffer {
  return data instanceof ArrayBuffer ? data : encoder.encode(JSON.stringify(data)).buffer as ArrayBuffer;
}

function ensureFramework(): void {
  if (!CubismFramework.isStarted() && !CubismFramework.startUp()) {
    throw new Error('Unable to start the Cubism 5.3 SDK (Web R5) Framework.');
  }
  if (!CubismFramework.isInitialized()) CubismFramework.initialize();
}

function checkMocVersion(data: ArrayBuffer): void {
  const version = CubismMoc.getMocVersionFromBuffer(data);
  const maximum = Math.min(6, Live2DCubismCore.Version.csmGetLatestMocVersion());
  if (version <= 0) throw new Error('Invalid or unrecognized Cubism moc3 data.');
  if (version > maximum) {
    throw new Error(`Unsupported moc3 version ${version}; this Cubism 5.3 SDK (Web R5) runtime supports versions 1–${maximum}. Update the runtime to load this model.`);
  }
}

function releaseCore(model: CubismModel): void {
  const moc = ownedMocs.get(model);
  if (!moc) return;
  ownedMocs.delete(model);
  try {
    moc.deleteModel(model);
  } finally {
    moc.release();
  }
}

function stopQueue(queue: CubismMotionQueueManager): void {
  // R5 stopAllMotions splices while incrementing, leaving alternate entries.
  const entries = queue.getCubismMotionQueueEntries();
  while (entries.length) entries.pop()!.release();
}

/** Register modern model3-shaped settings in the existing Cubism2-only factory.
 * No second common runtime, ticker, remote shaders, or legacy Cubism4 renderer.
 */
export function registerCubism5Runtime(): void {
  // Only types are imported from npm; classic scripts own these constructors.
  const globals = globalThis as typeof globalThis & { PIXI?: PixiRuntime };
  const PIXI = globals.PIXI;
  const common = PIXI?.live2d;
  if (!PIXI || !common?.Live2DFactory) throw new Error('Load Pixi and the Cubism2 common runtime before the Cubism 5 adapter.');
  if (registrations.has(common.Live2DFactory)) return;

  class ModernSettings extends common.ModelSettings {
    declare json: ModelJSON;
    moc: string;
    textures: string[];
    motions: Record<string, MotionDefinition[]>;
    expressions: ExpressionDefinition[];
    layout?: Record<string, number>;
    hitAreas: { Id: string; Name: string }[];

    static isModern(source: unknown): source is ModelJSON {
      if (!source || typeof source !== 'object' || !('FileReferences' in source)) return false;
      const refs = source.FileReferences;
      return !!refs && typeof refs === 'object' && 'Moc' in refs && typeof refs.Moc === 'string'
        && 'Textures' in refs && Array.isArray(refs.Textures) && refs.Textures.length > 0
        && refs.Textures.every((texture: unknown) => typeof texture === 'string');
    }

    constructor(json: ModelJSON) {
      super(json);
      if (!ModernSettings.isModern(json)) throw new TypeError('Invalid Cubism model3 settings.');
      const refs = json.FileReferences;
      this.moc = refs.Moc;
      this.textures = refs.Textures.slice();
      this.pose = refs.Pose;
      this.physics = refs.Physics;
      this.motions = {};
      for (const [group, motions] of Object.entries(refs.Motions ?? {})) {
        this.motions[group] = motions.map(motion => ({ ...motion }));
      }
      this.expressions = (refs.Expressions ?? []).map(expression => ({ ...expression }));
      this.layout = json.Layout;
      this.hitAreas = json.HitAreas ?? [];
    }

    getEyeBlinkParameters(): string[] {
      return this.json.Groups?.find(group => group.Target === 'Parameter' && group.Name === 'EyeBlink')?.Ids ?? [];
    }

    getLipSyncParameters(): string[] {
      return this.json.Groups?.find(group => group.Target === 'Parameter' && group.Name === 'LipSync')?.Ids ?? [];
    }

    override replaceFiles(replace: (file: string, path: string) => string): void {
      super.replaceFiles(replace);
      for (const [group, motions] of Object.entries(this.motions)) {
        for (let i = 0; i < motions.length; i++) {
          const motion = motions[i];
          motion.File = replace(motion.File, `motions.${group}[${i}].File`);
          if (motion.Sound !== undefined) motion.Sound = replace(motion.Sound, `motions.${group}[${i}].Sound`);
        }
      }
      for (let i = 0; i < this.expressions.length; i++) {
        this.expressions[i].File = replace(this.expressions[i].File, `expressions[${i}].File`);
      }
    }
  }

  class ModernExpressions extends common.ExpressionManager<CubismExpressionMotion, ExpressionDefinition> {
    readonly definitions: ExpressionDefinition[];
    readonly queueManager = new CubismExpressionMotionManager();
    private readonly ownedExpressions = new Set<CubismExpressionMotion>();
    private deltaSeconds = 0;

    constructor(settings: ModernSettings) {
      super(settings);
      this.definitions = settings.expressions;
      this.init();
    }

    isFinished(): boolean {
      return this.queueManager.isFinished();
    }

    getExpressionIndex(name: string): number {
      return this.definitions.findIndex(definition => definition.Name === name);
    }

    getExpressionFile(definition: ExpressionDefinition): string {
      return definition.File;
    }

    createExpression(data: object, _definition?: ExpressionDefinition): CubismExpressionMotion {
      if (this.destroyed) throw new Error('Expression arrived after its Cubism model was destroyed.');
      const buffer = jsonBuffer(data);
      const expression = CubismExpressionMotion.create(buffer, buffer.byteLength);
      this.ownedExpressions.add(expression);
      return expression;
    }

    protected override async loadExpression(index: number): Promise<CubismExpressionMotion | undefined> {
      if (this.destroyed || !this.definitions[index]) return undefined;
      if (this.expressions[index] !== undefined) return this.expressions[index] ?? undefined;
      const expression = await common.Live2DFactory.loadExpression(this, index);
      if (this.destroyed) return undefined;
      this.expressions[index] = expression ?? null;
      return expression;
    }

    protected _setExpression(expression: CubismExpressionMotion): number {
      if (this.destroyed) return -1;
      return this.queueManager.startMotion(expression, false);
    }

    protected stopAllExpressions(): void {
      stopQueue(this.queueManager);
    }

    updateForFrame(model: CubismModel, dt: number, now: number): void {
      this.deltaSeconds = dt / 1000;
      this.update(model, now);
    }

    protected updateParameters(model: CubismModel, _now: number): boolean {
      return this.queueManager.updateMotion(model, this.deltaSeconds);
    }

    override destroy(): void {
      if (this.destroyed) return;
      this.reserveExpressionIndex = -1;
      stopQueue(this.queueManager);
      this.queueManager.release();
      // R5 expression release does not delegate to its queue base.
      CubismMotionQueueManager.prototype.release.call(this.queueManager);
      for (const expression of this.ownedExpressions) expression.release();
      this.ownedExpressions.clear();
      super.destroy();
    }
  }

  class ModernMotions extends common.MotionManager<CubismMotion, MotionDefinition> {
    readonly definitions: Record<string, MotionDefinition[]>;
    readonly groups = { idle: 'Idle' };
    readonly motionDataType = 'json' as const;
    readonly queueManager = new CubismMotionQueueManager();
    readonly eyeBlinkIds: CubismIdHandle[];
    readonly lipSyncIds: CubismIdHandle[];
    expressionManager?: ModernExpressions;
    private readonly ownedMotions = new Set<CubismMotion>();

    constructor(settings: ModernSettings, options?: MotionManagerOptions) {
      super(settings, options);
      this.definitions = settings.motions;
      const ids = CubismFramework.getIdManager();
      this.eyeBlinkIds = settings.getEyeBlinkParameters().map(id => ids.getId(id));
      this.lipSyncIds = settings.getLipSyncParameters().map(id => ids.getId(id));
      this.queueManager.setEventCallback((_caller, value) => this.emit(`motion:${value}`));
      if (settings.expressions.length) this.expressionManager = new ModernExpressions(settings);
      this.init(options);
    }

    isFinished(): boolean {
      return this.queueManager.isFinished();
    }

    protected _startMotion(motion: CubismMotion, onFinish?: (motion: CubismMotion) => void): number {
      if (this.destroyed) return -1;
      motion.setFinishedMotionHandler(onFinish ? () => onFinish(motion) : undefined);
      stopQueue(this.queueManager);
      return this.queueManager.startMotion(motion, false);
    }

    protected _stopAllMotions(): void {
      stopQueue(this.queueManager);
    }

    createMotion(data: object | ArrayBuffer, group: string, definition: MotionDefinition): CubismMotion {
      if (this.destroyed) throw new Error('Motion arrived after its Cubism model was destroyed.');
      const buffer = jsonBuffer(data);
      const motion = CubismMotion.create(buffer, buffer.byteLength);
      if (!motion) throw new Error(`Unable to parse Cubism motion: ${definition.File}`);
      this.ownedMotions.add(motion);
      const fading = (group === this.groups.idle ? common.config.idleMotionFadingDuration : common.config.motionFadingDuration) / 1000;
      // Match PLD 0.4: a motion's own Meta fade wins; model settings supply
      // missing fades, then the common configurable duration supplies defaults.
      // R5 parser fills missing fades with 1s, so inspect Meta before overriding.
      const json = data instanceof ArrayBuffer ? JSON.parse(new TextDecoder().decode(data)) : data;
      const meta = 'Meta' in json && json.Meta && typeof json.Meta === 'object' ? json.Meta : {};
      if (!('FadeInTime' in meta)) motion.setFadeInTime(definition.FadeInTime! > 0 ? definition.FadeInTime! : fading);
      if (!('FadeOutTime' in meta)) motion.setFadeOutTime(definition.FadeOutTime! > 0 ? definition.FadeOutTime! : fading);
      motion.setEffectIds(this.eyeBlinkIds, this.lipSyncIds);
      // Meta.Loop was metadata, not playback policy, in PLD 0.4 and R5.
      // Keep one-shot interactions/idle chaining. Callers can explicitly use
      // the official motion.setLoop(true) API on a loaded motion.
      return motion;
    }

    getMotionFile(definition: MotionDefinition): string {
      return definition.File;
    }

    protected getMotionName(definition: MotionDefinition): string {
      return definition.File;
    }

    protected getSoundFile(definition: MotionDefinition): string | undefined {
      return definition.Sound;
    }

    protected updateParameters(model: CubismModel, now: number): boolean {
      return this.queueManager.doUpdateMotion(model, now / 1000);
    }

    override destroy(): void {
      if (this.destroyed) return;
      super.destroy();
      this.queueManager.release();
      for (const motion of this.ownedMotions) motion.release();
      this.ownedMotions.clear();
    }
  }

  class ModernInternalModel extends common.InternalModel {
    readonly coreModel: CubismModel;
    readonly settings: ModernSettings;
    motionManager: ModernMotions;
    readonly pixelsPerUnit: number;
    lipSync = true;
    lipSyncValue = 0;
    breath?: CubismBreath;
    eyeBlink?: CubismEyeBlink;
    declare pose?: CubismPose;
    declare physics?: CubismPhysics;
    renderer?: PixiCubismRenderer;
    private glState?: CubismGLState;
    private shaderLease?: ShaderLease;
    private readonly centeringTransform = new PIXI.Matrix();
    private readonly mvp = new CubismMatrix44();
    private readonly canvasVertices: (Float32Array | undefined)[] = [];
    private readonly idParamAngleX = CubismFramework.getIdManager().getId('ParamAngleX');
    private readonly idParamAngleY = CubismFramework.getIdManager().getId('ParamAngleY');
    private readonly idParamAngleZ = CubismFramework.getIdManager().getId('ParamAngleZ');
    private readonly idParamEyeBallX = CubismFramework.getIdManager().getId('ParamEyeBallX');
    private readonly idParamEyeBallY = CubismFramework.getIdManager().getId('ParamEyeBallY');
    private readonly idParamBodyAngleX = CubismFramework.getIdManager().getId('ParamBodyAngleX');

    constructor(coreModel: CubismModel, settings: ModernSettings, options?: InternalModelOptions) {
      super();
      this.coreModel = coreModel;
      this.settings = settings;
      this.pixelsPerUnit = coreModel.getPixelsPerUnit();
      try {
        this.motionManager = new ModernMotions(settings, options);
        this.init();
        this.centeringTransform.scale(this.pixelsPerUnit, this.pixelsPerUnit)
          .translate(this.originalWidth / 2, this.originalHeight / 2);
        if (this.motionManager.eyeBlinkIds.length) {
          this.eyeBlink = CubismEyeBlink.create();
          this.eyeBlink.setParameterIds(this.motionManager.eyeBlinkIds);
        }
        this.breath = CubismBreath.create();
        this.breath.setParameters([
          new BreathParameterData(this.idParamAngleX, 0, 15, 6.5345, 0.5),
          new BreathParameterData(this.idParamAngleY, 0, 8, 3.5345, 0.5),
          new BreathParameterData(this.idParamAngleZ, 0, 10, 5.5345, 0.5),
          new BreathParameterData(this.idParamBodyAngleX, 0, 4, 15.5345, 0.5),
          new BreathParameterData(CubismFramework.getIdManager().getId('ParamBreath'), 0, 0.5, 3.2345, 0.5),
        ]);
        coreModel.saveParameters();
      } catch (error) {
        this.motionManager?.destroy();
        releaseCore(coreModel);
        throw error;
      }
    }

    protected getSize(): [number, number] {
      const canvas = this.coreModel.getModel().canvasinfo;
      return [canvas.CanvasWidth, canvas.CanvasHeight];
    }

    protected getLayout(): CommonLayout {
      const layout: Record<string, number> = {};
      for (const [key, value] of Object.entries(this.settings.layout ?? {})) {
        layout[key.charAt(0).toLowerCase() + key.slice(1)] = value;
      }
      return layout;
    }

    protected getHitAreaDefs(): CommonHitArea[] {
      return this.settings.hitAreas.map(area => ({ id: area.Id, name: area.Name, index: this.getDrawableIndex(area.Id) }));
    }

    getDrawableIDs(): string[] {
      return this.coreModel.getModel().drawables.ids;
    }

    getDrawableIndex(id: string): number {
      return this.coreModel.getDrawableIndex(CubismFramework.getIdManager().getId(id));
    }

    getDrawableVertices(index: number | string): Float32Array {
      const drawable = typeof index === 'string' ? this.getDrawableIndex(index) : index;
      if (drawable < 0 || drawable >= this.coreModel.getDrawableCount()) throw new RangeError(`Unknown Cubism drawable: ${index}`);
      const source = this.coreModel.getDrawableVertices(drawable);
      let vertices = this.canvasVertices[drawable];
      if (!vertices || vertices.length !== source.length) this.canvasVertices[drawable] = vertices = new Float32Array(source.length);
      for (let i = 0; i < source.length; i += 2) {
        vertices[i] = source[i] * this.pixelsPerUnit + this.originalWidth / 2;
        vertices[i + 1] = -source[i + 1] * this.pixelsPerUnit + this.originalHeight / 2;
      }
      // Public InternalModel vertices are model-canvas coordinates. Core's
      // getDrawableVertices stays untouched and borrowed for dynamic bounds.
      return vertices;
    }

    override updateTransform(transform: Matrix): void {
      this.drawingMatrix.copyFrom(this.centeringTransform).prepend(this.localTransform).prepend(transform);
    }

    override update(dt: number, now: number): void {
      if (this.destroyed) return;
      super.update(dt, now);
      const model = this.coreModel;
      const seconds = dt / 1000;
      this.emit('beforeMotionUpdate');
      const motionUpdated = this.motionManager.update(model, now);
      this.emit('afterMotionUpdate');
      model.saveParameters();
      this.motionManager.expressionManager?.updateForFrame(model, dt, now);
      if (!motionUpdated) this.eyeBlink?.updateParameters(model, seconds);
      this.updateFocus();
      this.updateNaturalMovements(dt, now);
      if (this.lipSync && this.lipSyncValue !== 0) {
        for (const id of this.motionManager.lipSyncIds) model.addParameterValueById(id, this.lipSyncValue, 0.8);
      }
      this.physics?.evaluate(model, seconds);
      this.pose?.updateParameters(model, seconds);
      this.emit('beforeModelUpdate');
      model.update();
      model.loadParameters();
    }

    updateFocus(): void {
      const focus = this.focusController;
      this.coreModel.addParameterValueById(this.idParamEyeBallX, focus.x);
      this.coreModel.addParameterValueById(this.idParamEyeBallY, focus.y);
      this.coreModel.addParameterValueById(this.idParamAngleX, focus.x * 30);
      this.coreModel.addParameterValueById(this.idParamAngleY, focus.y * 30);
      this.coreModel.addParameterValueById(this.idParamAngleZ, focus.x * focus.y * -30);
      this.coreModel.addParameterValueById(this.idParamBodyAngleX, focus.x * 10);
    }

    updateNaturalMovements(dt: number, _now: number): void {
      this.breath?.updateParameters(this.coreModel, dt / 1000);
    }

    updateWebGLContext(gl: WebGLRenderingContext, glContextID: number): void {
      if (this.destroyed) throw new Error('Cannot render a destroyed Cubism model.');
      if (this.coreModel.isBlendModeEnabled() && !isWebGL2(gl)) {
        throw new Error('This Cubism model uses 5.3 blending/offscreen effects and requires WebGL 2.');
      }
      this.releaseRenderer();
      const state = new CubismGLState(gl);
      this.glState = state;
      state.save();
      try {
        this.shaderLease = acquireShaders(gl, glContextID);
        const renderer = new PixiCubismRenderer(state.viewport[2], state.viewport[3], state);
        this.renderer = renderer;
        renderer.initialize(this.coreModel);
        renderer.setIsPremultipliedAlpha(true);
        renderer.startUp(gl);
      } catch (error) {
        this.releaseRenderer(false);
        throw error;
      } finally {
        state.restore();
      }
    }

    bindTexture(index: number, texture: WebGLTexture): void {
      this.renderer!.bindTexture(index, texture);
    }

    draw(gl: WebGLRenderingContext): void {
      if (this.destroyed) return;
      const state = this.glState;
      const renderer = this.renderer;
      if (!state || !renderer || state.gl !== gl) throw new Error('Cubism renderer is not initialized for this WebGL context.');
      if (this.viewport[2] <= 0 || this.viewport[3] <= 0) return;
      const matrix = this.drawingMatrix;
      const array = this.mvp.getArray();
      array[0] = matrix.a;
      array[1] = matrix.b;
      array[4] = -matrix.c;
      array[5] = -matrix.d;
      array[12] = matrix.tx;
      array[13] = matrix.ty;
      state.save();
      const offscreenManager = CubismWebGLOffscreenManager.getInstance();
      offscreenManager.beginFrameProcess(gl);
      try {
        renderer.setMvpMatrix(this.mvp);
        renderer.setRenderState(state.framebuffer, this.viewport);
        renderer.drawModel();
      } finally {
        offscreenManager.stopUsingAllRenderTextures(gl);
        offscreenManager.endFrameProcess(gl);
        state.restore();
      }
    }

    private releaseRenderer(saveState = true): void {
      const state = this.glState;
      if (saveState) state?.save();
      try {
        this.renderer?.release();
      } finally {
        if (saveState) state?.restore();
        state?.release();
        this.renderer = undefined;
        this.glState = undefined;
        if (this.shaderLease) releaseShaders(this.shaderLease);
        this.shaderLease = undefined;
      }
    }

    override destroy(): void {
      if (this.destroyed) return;
      try {
        super.destroy();
      } finally {
        this.releaseRenderer();
        if (this.physics) CubismPhysics.delete(this.physics);
        if (this.pose) CubismPose.delete(this.pose);
        if (this.eyeBlink) CubismEyeBlink.delete(this.eyeBlink);
        if (this.breath) CubismBreath.delete(this.breath);
        this.physics = undefined;
        this.pose = undefined;
        this.eyeBlink = undefined;
        this.breath = undefined;
        this.canvasVertices.length = 0;
        releaseCore(this.coreModel);
      }
    }
  }

  const runtime: Live2DRuntime = {
    version: 5,
    test: source => source instanceof ModernSettings || ModernSettings.isModern(source),
    ready: async () => ensureFramework(),
    isValidMoc(data) {
      checkMocVersion(data);
      return true;
    },
    createModelSettings(json) {
      if (!ModernSettings.isModern(json)) throw new TypeError('Invalid Cubism model3 settings.');
      return new ModernSettings(json);
    },
    createCoreModel(data) {
      ensureFramework();
      checkMocVersion(data);
      // This is the only consistency check. No check in isValidMoc or revive.
      const moc = CubismMoc.create(data, true);
      if (!moc) throw new Error('Cubism rejected inconsistent or invalid moc3 data.');
      let nativeModel: Live2DCubismCore.Model | undefined;
      try {
        // R5 CubismMoc.createModel does not release the native model if its
        // wrapper initialize throws. Mirror that fixed-version ownership seam
        // explicitly so *every* partial construction path frees Core memory.
        nativeModel = Live2DCubismCore.Model.fromMoc(moc._moc);
        if (!nativeModel) throw new Error('Unable to create Cubism Core model.');
        const model = new CubismModel(nativeModel);
        model.initialize();
        moc._modelCount++;
        ownedMocs.set(model, moc);
        return model;
      } catch (error) {
        nativeModel?.release();
        moc.release();
        throw error;
      }
    },
    createInternalModel(coreModel: CubismModel, settings, options) {
      try {
        if (!(settings instanceof ModernSettings)) throw new TypeError('Mismatched Cubism model settings.');
        return new ModernInternalModel(coreModel, settings, options);
      } catch (error) {
        releaseCore(coreModel);
        throw error;
      }
    },
    createPose(coreModel: CubismModel, data: object) {
      if (!ownedMocs.has(coreModel)) throw new Error('Pose arrived after its Cubism model was destroyed.');
      const buffer = jsonBuffer(data);
      const pose = CubismPose.create(buffer, buffer.byteLength);
      if (!pose) throw new Error('Unable to parse Cubism pose.');
      return pose;
    },
    createPhysics(coreModel: CubismModel, data: object) {
      if (!ownedMocs.has(coreModel)) throw new Error('Physics arrived after its Cubism model was destroyed.');
      const buffer = jsonBuffer(data);
      return CubismPhysics.create(buffer, buffer.byteLength);
    },
  };
  common.Live2DFactory.registerRuntime(runtime);
  registrations.add(common.Live2DFactory);
}
