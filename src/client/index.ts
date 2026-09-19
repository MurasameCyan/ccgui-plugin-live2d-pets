/**
 * CC GUI browser half: mounts the persistent Live2D overlay and handles all
 * interaction locally. Runtime state arrives through PluginContext hooks;
 * vendor scripts are bundled resources accessed through ctx.assets.
 *
 * The overlay host supplies a fixed, pointer-transparent viewport. This
 * module owns the interactive canvas, position persistence, model loading,
 * state bubbles, motion priority, focus suppression, and visibility throttling.
 */

import { createElement, useEffect, useRef } from "../react-runtime";
import type { ReactNode } from "../sdk";
import type { PetRuntime, PetState, PetStateView } from "../runtime";
import { resolvePersonaCopy } from "./personas";
import type { CopyTable } from "../persona-shared";
import { DEFAULT_PERSONA_ID } from "../persona-shared";
import {
  DEFAULT_MOTION_MAP,
  DEFAULT_SPATIAL_TAP,
  type AnimationSlot,
  type MotionMap,
  type SpatialTapConfig,
} from "../models";

interface DisplayLike { right: number; bottom: number; size: number }

interface DebugMotionItem {
  group: string
  index: number
  label: string
}

interface ModelLike {
  width: number
  height: number
  autoUpdate: boolean
  anchor: { set(x: number, y: number): void }
  scale: { set(s: number): void }
  position: { set(x: number, y: number): void }
  motion(name: string, index?: number, priority?: MotionPriority): Promise<boolean>
  destroy(): void
  focus(x: number, y: number, instant?: boolean): void
  hitTest(x: number, y: number): string[]
  getBounds?: () => { x: number; y: number; width: number; height: number }
  internalModel?: {
    hitAreas?: Record<string, unknown>
    focusController?: { focus(x: number, y: number, instant?: boolean): void }
    motionManager?: {
      on?(event: "motionFinish", listener: () => void): unknown
      off?(event: "motionFinish", listener: () => void): unknown
      stopAllMotions?(): void
      definitions?: Record<string, unknown>
    }
  }
}

type TapPart = "head" | "leg" | "arm" | "body"

/** Vendor paths resolved through the host asset bridge. */
const VENDOR_SCRIPTS = [
  "vendor/pixi.min.js",
  // Replaces PIXI's generated uniform sync functions without weakening CSP.
  "vendor/pixi-unsafe-eval.min.js",
  "vendor/live2dcubismcore.min.js",
  "vendor/live2d-display.cubism4.min.js",
];


/** 点击/拖动判定阈值（px）。 */
const DRAG_THRESHOLD = 6
/** 点击互动防抖（ms）：仅挡同一次 pointer 误触双发，不等气泡播完（spec §4）。 */
const TAP_DEBOUNCE_MS = 80
/** 瞬态气泡显示时长（ms）：到时自动隐藏或回落阶段文案。 */
const BUBBLE_DISPLAY_MS = 2500
/**
 * 默认渲染帧率上限（spec §2/§7）：未封顶时 PIXI ticker 可达 120–140fps，
 * 长时间挂页会持续占满 GPU/主线程；桌宠动画默认 30fps 足够，用户可在设置中改档。
 */
const DEFAULT_MAX_FPS = 30
/**
 * PIXI.UPDATE_PRIORITY.UTILITY(-50)：排在 Application 的 render(LOW=-25) 之后。
 * 绘制区域测量与指针命中探测都必须读“已渲染”的帧缓冲，NORMAL(0) 会读到空帧。
 */
const TICKER_PRIORITY_UTILITY = -50
/** 绘制区域密集采样窗口：加载后这么多 ticker 帧内每 2 帧采样一次，覆盖起始动作摆动。 */
const ART_SAMPLE_TICKS = 300
/** 密集采样间隔（每 N 帧读一次帧缓冲）。 */
const ART_SAMPLE_EVERY = 2
/** 采样窗口结束后的看门狗间隔（每 N 帧读一次）：迟到的动作/互动姿势仍会并入绘制区域。 */
const ART_WATCHDOG_EVERY = 60
/** 采样包围盒贴到画布边缘时的外扩量（画布像素）：说明测量被画布截断。 */
const ART_EDGE_MARGIN_PX = 12
/** 共用 alpha 阈值：>16 视为可见（绘制区域测量与指针命中判定一致）。 */
const ALPHA_VISIBLE = 16
/** 指针命中探测半径（画布像素）：读指针附近的小块即可判定是否命中模型。 */
const HIT_PROBE_RADIUS = 6
/** 桌宠画布与视口的内边距：整只桌宠必须留在视口内（spec §4）。 */
const VIEWPORT_MARGIN = 16

/** pixi-live2d-display MotionPriority（对应库内枚举：NONE=0, IDLE=1, NORMAL=2, FORCE=3）。 */
const MotionPriority = {
  IDLE: 1,
  NORMAL: 2,
  FORCE: 3,
} as const
type MotionPriority = typeof MotionPriority[keyof typeof MotionPriority]

/** 归一化配置帧率档（非法值回落默认 30）。 */
function normalizeMaxFps(raw: unknown): number {
  if (raw === 60 || raw === 0) return raw
  return DEFAULT_MAX_FPS
}
/**
 * 阶段演进气泡（spec §3）：思考/等审批为长状态（可达数十秒以上），气泡与
 * 状态同生命周期**常驻**，文案按入态后耗时推进（afterMs 为距入态偏移），
 * 阶段切换时重播一次状态动作；状态一变即被新状态表现取代。
 * 文案取自当前人设台词表（thinking1..3 / waiting1..3，spec §3 人设化台词）。
 */
const STAGED_DELAYS: Partial<Record<PetState, number[]>> = {
  thinking: [0, 15_000, 40_000],
  waiting: [0, 30_000, 90_000],
}
/** 长状态阶段文案池键。 */
type StageCopyKey = 'thinking1' | 'thinking2' | 'thinking3' | 'waiting1' | 'waiting2' | 'waiting3'
/** 长状态 → 台词池键（与 STAGED_DELAYS 下标对应）。 */
const STAGED_COPY_KEYS: Partial<Record<PetState, StageCopyKey[]>> = {
  thinking: ['thinking1', 'thinking2', 'thinking3'],
  waiting: ['waiting1', 'waiting2', 'waiting3'],
}
/** 短状态（瞬态气泡）→ 台词池键；无键的状态不冒泡。 */
const TRANSIENT_COPY_KEYS: Partial<Record<PetState, 'idle' | 'error' | 'done'>> = {
  idle: 'idle',
  error: 'error',
  done: 'done',
}
/** PIXI global (vendor scripts are loaded once by the plugin). */
declare const PIXI: {
  Application: new (options: Record<string, unknown>) => {
    stage: { addChild(child: unknown): unknown };
    ticker: {
      addOnce(fn: () => void, context?: unknown, priority?: number): unknown;
      add(fn: () => void, context?: unknown, priority?: number): unknown;
      remove(fn: () => void, context?: unknown): unknown;
      start(): unknown;
      stop(): unknown;
      maxFPS?: number;
    };
    renderer: { resize(width: number, height: number): unknown; gl?: WebGLRenderingContext };
    render(): void;
    destroy(remove: boolean): void;
  };
  live2d?: { Live2DModel?: {
    fromSync(url: string, options: {
      autoInteract: boolean;
      autoUpdate: boolean;
      onLoad(): void;
      onError(error: unknown): void;
    }): ModelLike;
  } };
};


/** 命中区域名 → 部位分桶（正则容错：不同模型命名不一）；未匹配的命中区域归身体。 */
const TAP_PART_MATCHERS: Array<{ part: TapPart; re: RegExp }> = [
  { part: 'head', re: /head|hair|face|头/i },
  { part: 'leg', re: /leg|foot|feet|shoe|腿|脚/i },
  { part: 'arm', re: /arm|hand|手/i },
]

/**
 * 按命中区域名优先级归类（头 > 腿 > 手 > 身体）；空列表返回 null。
 */
function classifyTapByName(hits: readonly string[]): TapPart | null {
  if (hits.length === 0) return null
  for (const { part, re } of TAP_PART_MATCHERS) {
    if (hits.some((name) => re.test(name))) return part
  }
  return 'body'
}

/**
 * 按点击在模型包围盒内的相对位置分档（spec §4：HitArea 不足时的空间回退）。
 * 五个矩形：头 / 身 / 腿（居中列）+ 左臂 / 右臂（侧列）；不落在任一矩形 → null。
 */
function classifyTapByPosition(
  localX: number,
  localY: number,
  bounds: { x: number; y: number; width: number; height: number },
  tap: SpatialTapConfig,
): TapPart | null {
  if (!(bounds.width > 0 && bounds.height > 0)) return null
  const nx = (localX - bounds.x) / bounds.width
  const ny = (localY - bounds.y) / bounds.height
  if (nx < 0 || nx > 1 || ny < 0 || ny > 1) return null
  if (ny < tap.headMaxNy && nx >= tap.headMinNx && nx <= tap.headMaxNx) return 'head'
  if (ny > tap.legMinNy && nx >= tap.bodyMinNx && nx <= tap.bodyMaxNx) return 'leg'
  if (ny >= tap.armMinNy && ny <= tap.legMinNy) {
    if (nx >= tap.armLeftMinNx && nx < tap.bodyMinNx) return 'arm'
    if (nx > tap.bodyMaxNx && nx <= tap.armRightMaxNx) return 'arm'
  }
  if (
    ny >= tap.headMaxNy
    && ny <= tap.legMinNy
    && nx >= tap.bodyMinNx
    && nx <= tap.bodyMaxNx
  ) return 'body'
  return null
}

/**
 * 综合命中名与空间回退（spec §4）：
 * - 命中名为头/腿/手 → 直接采用
 * - 空命中或仅身体/未识别名 → 盒内按相对位置分档；盒外不响应
 */
function classifyTap(
  hits: readonly string[],
  localX: number,
  localY: number,
  _hitAreaKeys: readonly string[],
  bounds: { x: number; y: number; width: number; height: number } | null,
  tap: SpatialTapConfig,
): TapPart | null {
  const named = classifyTapByName(hits)
  if (named === 'head' || named === 'leg' || named === 'arm') return named
  if (bounds) {
    const spatial = classifyTapByPosition(localX, localY, bounds, tap)
    if (spatial !== null) return spatial
  }
  return named
}

/** 从台词池随机取一句；可选避开上一条（池 ≥2 时，spec §4）。 */
function pickLine(pool: readonly string[], avoid?: string): string | undefined {
  if (pool.length === 0) return undefined
  if (pool.length === 1) return pool[0]
  const candidates = avoid ? pool.filter((line) => line !== avoid) : pool
  const list = candidates.length > 0 ? candidates : pool
  return list[Math.floor(Math.random() * list.length)]
}


/** vendor 脚本加载去重：同一 src 只注入一次、只等待同一份结果
 * （boot 在 StrictMode/HMR 下会重复执行，避免二次注入与重复初始化）。 */
const scriptPromises = new Map<string, Promise<void>>()

function loadScript(src: string): Promise<void> {
  let pending = scriptPromises.get(src)
  if (!pending) {
    pending = new Promise((resolve, reject) => {
      const s = document.createElement('script')
      s.src = src
      s.onload = () => resolve()
      s.onerror = () => reject(new Error(`script load failed: ${src}`))
      document.head.appendChild(s)
    })
    scriptPromises.set(src, pending)
  }
  return pending
}

interface PetAnchorProps { runtime: PetRuntime }

function PetAnchor(props: PetAnchorProps): ReactNode {
  const ref = useRef<HTMLDivElement | null>(null);
  useEffect(() => boot(ref.current, props.runtime), [props.runtime]);
  return createElement("div", { ref, style: { width: 0, height: 0 } });
}

function boot(anchor: HTMLDivElement | null, runtime: PetRuntime): (() => void) | undefined {
  if (!anchor) return undefined;
  const cleanup: Array<() => void> = []
  const pushCleanup = (fn: () => void) => { cleanup.push(fn) }
  // 卸载守卫：置位后异步加载在每个 await 点提前退出，避免重载残留。
  let disposed = false
  pushCleanup(() => { disposed = true })
  // 阶段推进/瞬态气泡计时随卸载清理。
  pushCleanup(() => { clearStages(); clearBubbleHideTimer() })
  pushCleanup(() => {
    if (sizeRaf) { window.cancelAnimationFrame(sizeRaf); sizeRaf = 0 }
    pendingSize = null
  })
  pushCleanup(() => { stopZoneLoop(); showSpatialZones = false })
  pushCleanup(() => teardownLayer())

  let box: HTMLDivElement | null = null
  let bubble: HTMLDivElement | null = null
  let debugEl: HTMLDivElement | null = null
  /** 调试面板“动画预览”数据：当前模型 MotionManager 暴露的全部具体动画。 */
  let debugMotionList: DebugMotionItem[] = []
  /** 按模型 URL 缓存原生动画列表，避免重复请求同一份 .model3.json。 */
  const motionListCache = new Map<string, DebugMotionItem[]>()
  let debugMotionSelect: HTMLSelectElement | null = null
  /** 调试面板状态文本容器：与演示按钮/动画预览并列，避免被 textContent 覆盖。 */
  let debugTextEl: HTMLDivElement | null = null
  /** 是否正处于 debug 原生动画预览：预览期间抑制 focus，结束后只恢复跟随，不触发状态恢复。 */
  let previewActive = false
  let canvas: HTMLCanvasElement | null = null
  /** 画布外包一层，便于绝对定位调试分区叠加层。 */
  let petLayer: HTMLDivElement | null = null
  let zoneOverlay: HTMLCanvasElement | null = null
  let showSpatialZones = false
  /** 当前模型生效的空间回退阈值（runtime 快照下发；默认 DEFAULT_SPATIAL_TAP）。 */
  let spatialTap: SpatialTapConfig = { ...DEFAULT_SPATIAL_TAP }
  /** 当前模型生效的状态/互动动画映射（runtime 快照下发；默认 DEFAULT_MOTION_MAP）。 */
  let motionMap: MotionMap = { ...DEFAULT_MOTION_MAP }
  let zoneRaf = 0
  let app: {
    destroy(remove?: boolean): void
    stage: { addChild(child: unknown): unknown }
    ticker: {
      addOnce(fn: () => void, context?: unknown, priority?: number): unknown
      add(fn: () => void, context?: unknown, priority?: number): unknown
      remove(fn: () => void, context?: unknown): unknown
      start(): unknown
      stop(): unknown
      maxFPS?: number
    }
    renderer: { resize(width: number, height: number): unknown; gl?: WebGLRenderingContext }
    render?: () => void
  } | null = null
  let model: ModelLike | null = null
  let hitAreas: string[] = []
  let currentModelUrl: string | null = null
  let vendorsReady = false
  let fallbackShown = false
  let fallbackEl: HTMLDivElement | null = null
  // 模型基础尺寸（scale=1 时捕获一次；避免按当前 scale 累积误差）。
  let baseModelW = 0
  let baseModelH = 0
  // 实测绘制区域（画布像素除以 scale 归一）：模型盒常远宽于实际绘制区域
  // （Hiyori 实测仅占盒宽 35%），据其收紧画布后桌宠才能贴边（spec §4）。
  let artMetrics: { w: number; h: number; cx: number; cy: number } | null = null
  /** 最近一次适配使用的 scale：读取帧缓冲时把画布像素换算回模型单位。 */
  let artScale = 0
  /** 摘除跨帧绘制区域测量（模型切换/卸载时必须停掉，否则 ticker 一直重试）。 */
  let detachArtMeasure: (() => void) | null = null
  /** 摘除指针命中探测（随渲染层一起销毁）。 */
  let detachHitProbe: (() => void) | null = null
  /** 待探测的指针位置（画布像素）：指针移动时记录，渲染后读取该处 alpha。 */
  let pendingHitProbe: { x: number; y: number } | null = null
  // 尺寸变更合并：连续设置更新只落地最后一档，避免串行 WebGL resize。
  let pendingSize: number | null = null
  let sizeRaf = 0
  let lastTapAt = 0
  /** 各点击台词池上一次抽中的句子（避开连抽同一句，spec §4）。 */
  const lastTapLine: Partial<Record<'tapHead' | 'tapLeg' | 'tapArm' | 'tapBody', string>> = {}
  /** 互动动作世代：新互动或新非 idle 状态动作会作废上一次互动的恢复回调。 */
  let interactionGen = 0
  /** 动作启动世代：任何新动作都会使异步 fallback/旧启动失效，避免被 stopAllMotions 打断后继续启动。 */
  let motionSeq = 0
  /** 是否正在播放互动动作（motionFinish 后据此恢复当前状态动作）。 */
  let interactionActive = false
  /** 是否抑制鼠标跟随：非 idle 动作播放期间为 true（spec §4）。 */
  let focusSuppressed = false
  let lastPointerClient: { x: number; y: number } | null = null
  let detachMotionFinish: (() => void) | null = null
  let bubbleHideTimer: number | undefined
  let stageTimers: number[] = []
  let stagedState: PetState | null = null
  let stageIndex = 0
  let lastState: PetState | null = null
  let demoState: PetState | null = null
  let view: PetStateView | null = null
  let pos: DisplayLike = { right: 24, bottom: 20, size: 160 }
  // 帧率档（settings maxFps → ticker.maxFPS；0 = 不限制）
  let maxFps = DEFAULT_MAX_FPS
  // 渲染开关：插件 enabled（配置）与页面可见性（spec §7）共同决定 ticker 是否运行；
  // 用户可开启「窗口非激活时保持动态」忽略失焦/隐藏暂停。
  let enabled = true
  let hidden = document.visibilityState !== 'visible'
  let keepAnimatingWhenInactive = false
  // 当前人设台词表（spec §3：内置常量 or 自定义 base 链合并；人设切换时热更新）
  let activePersonaId: string = DEFAULT_PERSONA_ID
  let activeCopy: CopyTable = resolvePersonaCopy(DEFAULT_PERSONA_ID, [])
  let lastCustomPersonas: PetStateView['customPersonas'] = []
  let personaDefsVersion = -1

  /** 合并 enabled/隐藏/失焦状态，启停渲染循环（spec §7：暂停渲染保留最后画面）。 */
  function syncTicker(): void {
    if (!app) return
    const shouldRun = enabled && (keepAnimatingWhenInactive || !hidden)
    // Live2D owns a separate shared-ticker subscription; pause only this
    // model, never PIXI.Ticker.shared (which other plugins may also use).
    if (model) model.autoUpdate = shouldRun
    if (shouldRun) { try { app.ticker.start() } catch { /* 已启动 */ } }
    else { try { app.ticker.stop() } catch { /* 已停止 */ } }
  }

  /** 应用渲染帧率上限（spec §2/§7；0 = PIXI 不设上限）。 */
  function applyMaxFps(next: number): void {
    maxFps = normalizeMaxFps(next)
    if (!app?.ticker) return
    try { app.ticker.maxFPS = maxFps } catch { /* 旧 ticker */ }
  }

  function clearBubbleHideTimer(): void {
    if (bubbleHideTimer !== undefined) {
      window.clearTimeout(bubbleHideTimer)
      bubbleHideTimer = undefined
    }
  }

  /** 显示常驻气泡文案：取消瞬态隐藏计时，气泡保持可见直到被取代。 */
  function setBubbleText(text: string): void {
    if (!bubble) return
    clearBubbleHideTimer()
    bubble.textContent = text
    bubble.style.opacity = '1'
  }

  /** 重绘当前阶段文案（阶段推进/瞬态气泡到时回落/拖拽结束后恢复）。 */
  function showStageText(): void {
    if (!stagedState) return
    const key = STAGED_COPY_KEYS[stagedState]?.[stageIndex]
    if (!key) return
    const line = pickLine(activeCopy[key])
    if (line !== undefined) setBubbleText(line)
  }

  /**
   * 瞬态气泡（交互/短状态，spec §3/§4）：立刻换文案并重置隐藏计时（连点可打断）；
   * 到时隐藏——若正处于阶段演进状态则回落到当前阶段文案（交互短暂抢占常驻气泡，过后归还）。
   */
  function showBubble(text: string): void {
    if (!bubble) return
    clearBubbleHideTimer()
    setBubbleText(text)
    bubbleHideTimer = window.setTimeout(() => {
      bubbleHideTimer = undefined
      if (stagedState) showStageText()
      else if (bubble) bubble.style.opacity = '0'
    }, BUBBLE_DISPLAY_MS)
  }

  /** 退出阶段演进状态：取消全部阶段计时并复位标记。 */
  function clearStages(): void {
    for (const t of stageTimers) window.clearTimeout(t)
    stageTimers = []
    stagedState = null
    stageIndex = 0
  }

  /** 进入阶段演进状态：立即显示阶段 0 并按偏移调度后续阶段（spec §3）。 */
  function enterStaged(state: PetState): void {
    clearStages()
    const delays = STAGED_DELAYS[state]
    const keys = STAGED_COPY_KEYS[state]
    if (!delays || !keys || delays.length === 0) return
    stagedState = state
    stageIndex = 0
    showStageText()
    for (let i = 1; i < delays.length; i++) {
      stageTimers.push(window.setTimeout(() => {
        stageIndex = i
        // 拖拽中暂停气泡与动作（spec §4），阶段静默推进、松手后恢复新阶段
        if (!dragging) {
          showStageText()
          playState(state)
        }
      }, delays[i]))
    }
  }

  /** 按 client 坐标应用鼠标跟随（model.focus 吃 canvas 本地坐标）。 */
  function applyFocus(clientX: number, clientY: number): void {
    if (!model || !canvas) return
    const rect = canvas.getBoundingClientRect()
    model.focus(clientX - rect.left, clientY - rect.top)
  }

  /** 解除非 idle 动作期间的 focus 抑制；若有最近指针位置则立即恢复跟随。 */
  function releaseFocusSuppression(): void {
    if (!focusSuppressed) return
    focusSuppressed = false
    if (model && lastPointerClient && !dragging && enabled && !hidden) {
      applyFocus(lastPointerClient.x, lastPointerClient.y)
    }
  }

  /**
   * 取某状态/互动部位的播放候选动作组：
   * - 配置过动画映射 → 随机打乱后逐个尝试（多选=随机选择，不是优先级排序）
   * - 未配置 → 默认候选链（保持旧版有序 fallback）
   */
  function motionNamesFor(slot: AnimationSlot): string[] {
    const configured = motionMap[slot]
    if (configured && configured.length > 0) {
      const names = [...configured]
      for (let i = names.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1))
        ;[names[i], names[j]] = [names[j], names[i]]
      }
      // 配置的动作组全部失败时，仍回退到默认候选，避免模型/配置变化后完全无动作
      const defaults = DEFAULT_MOTION_MAP[slot] ?? []
      for (const name of defaults) {
        if (!names.includes(name)) names.push(name)
      }
      return names
    }
    return DEFAULT_MOTION_MAP[slot] ?? []
  }

  /**
   * 按候选动作链启动动作，统一处理优先级、重播前 stopAllMotions、布尔返回值 fallback。
   * - idle 用 IDLE 优先级；状态/互动用 FORCE（NORMAL 不能打断 NORMAL，无法满足状态立即切换）。
   * - 非 idle 动作启动时抑制 focus，并等 motionFinish 真正播完后再恢复。
   */
  async function startMotionWithPriority(
    names: readonly string[],
    priority: MotionPriority,
    options: { suppressFocus: boolean; isInteraction: boolean },
  ): Promise<boolean> {
    if (!model || names.length === 0) return false
    const seq = ++motionSeq
    const currentModel = model
    previewActive = false
    if (options.suppressFocus) {
      focusSuppressed = true
      currentModel.internalModel?.focusController?.focus(0, 0, true)
    } else {
      releaseFocusSuppression()
    }
    if (options.isInteraction) interactionActive = true
    // 重播同一动作前必须清 MotionState；否则库会因“同 group+index 已激活”拒绝启动。
    currentModel.internalModel?.motionManager?.stopAllMotions?.()
    for (const name of names) {
      if (seq !== motionSeq || !model) return false
      try {
        const ok = await model.motion(name, undefined, priority)
        if (seq !== motionSeq || !model) return false
        if (ok) return true
      } catch {
        if (seq !== motionSeq || !model) return false
        // 单个候选失败/返回 false 时继续尝试下一个
      }
    }
    // 全部候选都失败：清理本次的互动/焦点标记（若期间已被新动作取代则不动）。
    if (seq === motionSeq) {
      if (options.isInteraction) interactionActive = false
      if (options.suppressFocus) releaseFocusSuppression()
    }
    return false
  }

  function playState(state: PetState): void {
    if (!model) return
    const names = motionNamesFor(state)
    if (names.length === 0) return
    // 任何状态动作（含回到 idle）都会取代正在播放的互动/旧状态动作
    interactionGen += 1
    interactionActive = false
    const priority = state === 'idle' ? MotionPriority.IDLE : MotionPriority.FORCE
    void startMotionWithPriority(names, priority, { suppressFocus: state !== 'idle', isInteraction: false })
  }

  /** MotionManager.motionFinish：动作真正播完。互动结束后恢复当前状态动作并解除 focus 抑制。
   * 注意该事件在库内部 state.complete()/自动回 idle 之前同步触发，恢复动作需延到微任务，
   * 避免在 MotionManager.update 中间重入修改 MotionState。 */
  function handleMotionFinish(): void {
    const wasPreview = previewActive
    previewActive = false
    const wasInteraction = interactionActive
    const gen = interactionGen
    const seq = motionSeq
    interactionActive = false
    queueMicrotask(() => {
      // 若期间已有新动作启动（motionSeq 变化），由新动作接管焦点/恢复，这里不再处理
      if (seq !== motionSeq) return
      releaseFocusSuppression()
      // debug 原生预览结束后只恢复 focus，不触发状态动作恢复
      if (wasPreview) return
      if (wasInteraction && gen === interactionGen && !interactionActive && lastState) {
        playState(lastState)
      }
    })
  }

  function applyState(next: PetStateView | null): void {
    const state = demoState ?? next?.state ?? 'idle'
    // 人设热更新（spec §3）：persona 或自定义清单变化时重算台词表；
    // 若正处于长状态，当前阶段气泡立即换新语气重绘（不打断计时节奏）
    const personaId = next?.config.persona || DEFAULT_PERSONA_ID
    if (personaId !== activePersonaId || personaDefsVersion !== next?.version) {
      const customs = next?.customPersonas ?? []
      const changed = personaId !== activePersonaId
        || customs.length !== lastCustomPersonas.length
        || customs.some((p, i) => p !== lastCustomPersonas[i])
      if (changed) {
        lastCustomPersonas = customs
        activePersonaId = personaId
        activeCopy = resolvePersonaCopy(personaId, customs)
        if (stagedState && !dragging) showStageText()
      }
      personaDefsVersion = next?.version ?? -1
    }
    // 状态变化时播状态气泡与状态动作（spec §3）：长状态（思考/等审批）走
    // 阶段演进常驻气泡，短状态气泡瞬态显示；点击互动另走 handleTap（可连点打断）。
    // 动作只在状态变化（及长状态阶段推进）时触发；startMotionWithPriority 会先
    // stopAllMotions 再按优先级启动，保证状态动作可立即切换、阶段可重播。
    if (state !== lastState) {
      lastState = state
      if (STAGED_DELAYS[state]) {
        enterStaged(state)
      } else {
        clearStages()
        const key = TRANSIENT_COPY_KEYS[state]
        const line = key ? pickLine(activeCopy[key]) : undefined
        if (line !== undefined) showBubble(line)
      }
      playState(state)
    }
    if (debugTextEl) {
      debugTextEl.textContent =
        `agent: ${next?.agent ?? '-'}  pet: ${state}  v${next?.version ?? '-'}\n` +
        `persona: ${activePersonaId}  hitAreas: ${hitAreas.join(',') || '-'}\n` +
        `pos: ${Math.round(pos.right)},${Math.round(pos.bottom)}  size: ${pos.size}\n` +
        `bounds: ${Math.round(baseModelW)}x${Math.round(baseModelH)}  canvas: ${canvas?.width ?? 0}x${canvas?.height ?? 0}`
    }
  }

  /** 静态头像降级（WebGL 不可用 / 模型加载失败，spec §7）。 */
  function showFallback(): void {
    if (!box || fallbackShown) return
    fallbackShown = true
    fallbackEl = document.createElement('div')
    fallbackEl.style.cssText = 'pointer-events:auto;width:64px;height:64px;display:flex;align-items:center;justify-content:center;font-size:36px;background:linear-gradient(135deg,#667eea,#764ba2);border-radius:16px;color:#fff'
    fallbackEl.textContent = '🐾'
    box.appendChild(fallbackEl)
  }

  /** 移除静态头像占位（模型（重新）加载前调用，避免降级与画布叠加）。 */
  function removeFallback(): void {
    if (fallbackEl && fallbackEl.parentNode) fallbackEl.parentNode.removeChild(fallbackEl)
    fallbackEl = null
    fallbackShown = false
  }

  /** 绘制区域或模型盒的宽高比（无实测区域时退回模型盒）。 */
  function artRatio(): { w: number; h: number } {
    return artMetrics ? { w: artMetrics.w, h: artMetrics.h } : { w: baseModelW, h: baseModelH }
  }

  /** 请求尺寸 → 实际渲染尺寸：桌宠整只可见（spec §4）。
   * 高度 = artH * (size - 8) / artW + 8 ≤ 视口高 - 边距，超出的模型自动缩小。 */
  function renderedSizeFor(requested: number): number {
    const { w: ratioW, h: ratioH } = artRatio()
    let size = Math.min(requested, Math.max(40, window.innerWidth - VIEWPORT_MARGIN))
    if (ratioW > 0 && ratioH > 0) {
      const maxHeight = Math.max(80, window.innerHeight - VIEWPORT_MARGIN)
      size = Math.min(size, 8 + ((maxHeight - 8) * ratioW) / ratioH)
    }
    return Math.max(16, Math.floor(size))
  }

  /** 画布尺寸：size = 可见宽度（有实测绘制区域时贴合绘制区域，否则按模型盒宽高比）。 */
  function canvasSizeFor(size: number): { width: number; height: number } {
    const { w: ratioW, h: ratioH } = artRatio()
    if (!(ratioW > 0 && ratioH > 0)) return { width: size, height: Math.round(size * 1.2) }
    const scale = (size - 8) / ratioW
    return { width: size, height: Math.max(1, Math.round(ratioH * scale) + 8) }
  }

  /** 按当前尺寸重新适配模型（画布已就绪时调用；基准尺寸为 scale=1 时捕获值）。 */
  function fitModel(): void {
    if (!model || !canvas) return
    const size = renderedSizeFor(pos.size)
    const { w: ratioW, h: ratioH } = artRatio()
    if (!(ratioW > 0 && ratioH > 0)) return
    const scale = (size - 8) / ratioW
    artScale = scale
    model.scale.set(scale)
    model.anchor.set(0.5, 0.5)
    if (artMetrics) {
      model.position.set(canvas.width / 2 - artMetrics.cx * scale, canvas.height / 2 - artMetrics.cy * scale)
    } else {
      model.position.set(canvas.width / 2, canvas.height / 2)
    }
  }

  /** 采样一帧帧缓冲并并入绘制区域（并集，只增不减）；返回 true 表示需要按新区域重排。 */
  function sampleArtBounds(scale: number): boolean {
    const gl = app?.renderer?.gl
    if (!gl || typeof gl.readPixels !== 'function' || !canvas) return false
    const w = canvas.width
    const h = canvas.height
    if (!(w > 0 && h > 0) || !(scale > 0)) return false
    const pixels = new Uint8Array(w * h * 4)
    try {
      gl.readPixels(0, 0, w, h, gl.RGBA, gl.UNSIGNED_BYTE, pixels)
    } catch {
      return false
    }
    let minX = w
    let maxX = -1
    let minY = h
    let maxY = -1
    for (let y = 0; y < h; y += 1) {
      const row = y * w * 4
      // readPixels 原点在左下，换算成画布坐标
      const canvasY = h - 1 - y
      for (let x = 0; x < w; x += 1) {
        if (pixels[row + x * 4 + 3] > ALPHA_VISIBLE) {
          if (x < minX) minX = x
          if (x > maxX) maxX = x
          if (canvasY < minY) minY = canvasY
          if (canvasY > maxY) maxY = canvasY
        }
      }
    }
    if (maxX < 0 || maxY < 0) return false
    // 贴边的包围盒说明这一帧的绘制区域被画布截断：外扩，避免继续裁切（spec §4）。
    let x0 = minX
    let x1 = maxX
    let y0 = minY
    let y1 = maxY
    if (minX <= 1) x0 -= ART_EDGE_MARGIN_PX
    if (maxX >= w - 2) x1 += ART_EDGE_MARGIN_PX
    if (minY <= 1) y0 -= ART_EDGE_MARGIN_PX
    if (maxY >= h - 2) y1 += ART_EDGE_MARGIN_PX
    const artW = x1 - x0 + 1
    const artH = y1 - y0 + 1
    if (artW < 8 || artH < 8) return false
    const sample = {
      w: artW / scale,
      h: artH / scale,
      cx: ((x0 + x1 + 1) / 2 - w / 2) / scale,
      cy: ((y0 + y1 + 1) / 2 - h / 2) / scale,
    }
    if (!artMetrics) {
      artMetrics = sample
      return true
    }
    const merged = {
      w: Math.max(artMetrics.w, sample.w),
      h: Math.max(artMetrics.h, sample.h),
      cx: sample.cx,
      cy: sample.cy,
    }
    const grew = merged.w > artMetrics.w + 0.5 || merged.h > artMetrics.h + 0.5
    artMetrics = merged
    return grew
  }

  /** 指针命中探测：渲染后读指针附近一小块帧缓冲，据此决定画布是否拦截指针。
   * 透明处放行（点击落到下方宿主组件），有像素处拦截（桌宠仍可点击/拖动，spec §4）。 */
  function probePointerHit(): void {
    const probe = pendingHitProbe
    if (!probe || !canvas) return
    if (dragging) return
    pendingHitProbe = null
    const gl = app?.renderer?.gl
    if (!gl || typeof gl.readPixels !== 'function') return
    const x = Math.max(0, Math.min(canvas.width - 1, Math.floor(probe.x) - HIT_PROBE_RADIUS))
    const y = Math.max(0, Math.min(canvas.height - 1, Math.floor(probe.y) - HIT_PROBE_RADIUS))
    const w = Math.min(HIT_PROBE_RADIUS * 2 + 1, canvas.width - x)
    const h = Math.min(HIT_PROBE_RADIUS * 2 + 1, canvas.height - y)
    if (!(w > 0 && h > 0)) return
    const pixels = new Uint8Array(w * h * 4)
    try {
      gl.readPixels(x, y, w, h, gl.RGBA, gl.UNSIGNED_BYTE, pixels)
    } catch {
      return
    }
    // readPixels 原点在左下：探测点换算到 GL 坐标后包含在读取块内。
    let hit = false
    for (let index = 3; index < pixels.length; index += 4) {
      if (pixels[index] > ALPHA_VISIBLE) { hit = true; break }
    }
    canvas.style.pointerEvents = hit ? 'auto' : 'none'
  }

  /** 桌宠盒当前屏幕尺寸（画布位图尺寸优先；无画布时为降级爪印/尺寸档）。 */
  function petBoxSize(): { w: number; h: number } {
    if (canvas) return { w: canvas.width, h: canvas.height }
    if (fallbackEl) return { w: 64, h: 64 }
    return { w: Math.round(pos.size), h: Math.round(pos.size * 1.2) }
  }

  /** 把 right/bottom 钳制在视口内：桌宠可贴右/下边，但不能被拖出画面（spec §4）。 */
  function clampDisplay(next: { right: number; bottom: number; size: number }): { right: number; bottom: number; size: number } {
    const { w, h } = petBoxSize()
    const maxRight = Math.max(0, window.innerWidth - w)
    const maxBottom = Math.max(0, window.innerHeight - h)
    return {
      right: Math.min(Math.max(0, Math.round(next.right)), Math.round(maxRight)),
      bottom: Math.min(Math.max(0, Math.round(next.bottom)), Math.round(maxBottom)),
      size: next.size,
    }
  }

  /** 应用钳制后的位置到锚点（画布尺寸变化/窗口缩放/拖动共用）。 */
  function applyPosition(): void {
    if (!box) return
    pos = clampDisplay(pos)
    box.style.right = `${pos.right}px`
    box.style.bottom = `${pos.bottom}px`
  }

  /** 立即应用画布尺寸（size 视为可见宽度，受视口限制，spec §4）。 */
  function applySizeNow(nextSize: number): void {
    pos.size = nextSize
    if (!canvas || !app) return
    const renderSize = renderedSizeFor(nextSize)
    const canvasSize = canvasSizeFor(renderSize)
    canvas.width = canvasSize.width
    canvas.height = canvasSize.height
    try { app.renderer.resize(canvasSize.width, canvasSize.height) } catch { /* 旧渲染器 */ }
    if (zoneOverlay) {
      zoneOverlay.width = canvasSize.width
      zoneOverlay.height = canvasSize.height
      zoneOverlay.style.width = `${canvasSize.width}px`
      zoneOverlay.style.height = `${canvasSize.height}px`
    }
    syncDebugPanelWidth()
    if (model) fitModel()
    // 画布尺寸变化会改变可停靠范围：重新钳制位置。
    applyPosition()
    // 重设画布会清空位图：立刻重绘，否则拖动尺寸时合成帧是空白（抖动/闪烁）。
    try { app.render?.() } catch { /* 旧渲染器 */ }
  }

  /** 合并同帧/连发的尺寸变更：只落地最后一档，避免串行 WebGL resize。 */
  function scheduleSize(nextSize: number): void {
    if (nextSize === pos.size && pendingSize === null) return
    pendingSize = nextSize
    if (sizeRaf) return
    sizeRaf = window.requestAnimationFrame(() => {
      sizeRaf = 0
      const size = pendingSize
      pendingSize = null
      if (size !== null && size !== pos.size) applySizeNow(size)
    })
  }

  /** 销毁当前渲染层（app/canvas/模型引用/静态头像占位）。 */
  function teardownLayer(): void {
    down = null
    if (dragging) {
      dragging = false
      showStageText()
    }
    // 作废旧模型的所有动作启动/互动恢复；焦点抑制复位
    motionSeq += 1
    interactionGen += 1
    interactionActive = false
    previewActive = false
    focusSuppressed = false
    lastPointerClient = null
    detachMotionFinish?.()
    detachMotionFinish = null
    // 跨帧绘制区域测量绑在旧 ticker 上：必须在销毁 app 前摘掉，否则重试回调残留。
    detachArtMeasure?.()
    detachHitProbe?.()
    pendingHitProbe = null
    if (sizeRaf) { window.cancelAnimationFrame(sizeRaf); sizeRaf = 0 }
    pendingSize = null
    stopZoneLoop()
    // Application.destroy() does not destroy stage children by default.
    // Release the model's Cubism core before disposing its PIXI application.
    if (model) { try { model.destroy() } catch { /* 已销毁 */ } }
    if (app) { try { app.destroy(true) } catch { /* 已销毁 */ } }
    app = null
    model = null
    hitAreas = []
    baseModelW = 0
    baseModelH = 0
    artMetrics = null
    if (zoneOverlay && zoneOverlay.parentNode) zoneOverlay.parentNode.removeChild(zoneOverlay)
    zoneOverlay = null
    if (canvas && canvas.parentNode) canvas.parentNode.removeChild(canvas)
    canvas = null
    // 气泡临时移回 box，等待下次 petLayer 重建时再挂回
    if (bubble && petLayer && bubble.parentNode === petLayer && box) box.appendChild(bubble)
    if (petLayer && petLayer.parentNode) petLayer.parentNode.removeChild(petLayer)
    petLayer = null
    removeFallback()
  }

  /** 加载/重载模型层：销毁旧层 → 新建画布与 PIXI app → 绑定指针事件。 */
  async function loadModelLayer(url: string | null): Promise<void> {
    teardownLayer()
    if (disposed) return
    // A model switch can supersede a pending size frame during teardown.
    pos.size = view?.config.size ?? pos.size
    if (!url || !box) {
      showFallback()
      return
    }
    try {
      petLayer = document.createElement('div')
      // display:block：inline-block 的基线会让锚点底部多出约 6px 空白，桌宠无法真正贴底。
      petLayer.style.cssText = 'position:relative;display:block;pointer-events:none'
      canvas = document.createElement('canvas')
      const size = pos.size
      canvas.width = size
      canvas.height = Math.round(size * 1.2)
      canvas.style.cssText = 'pointer-events:auto;display:block'
      zoneOverlay = document.createElement('canvas')
      zoneOverlay.width = canvas.width
      zoneOverlay.height = canvas.height
      zoneOverlay.style.cssText = `position:absolute;left:0;top:0;width:${canvas.width}px;height:${canvas.height}px;pointer-events:none;z-index:2;display:${showSpatialZones ? 'block' : 'none'}`
      petLayer.appendChild(canvas)
      petLayer.appendChild(zoneOverlay)
      // 气泡改为相对 petLayer 定位，避免调试面板插入后把气泡顶到面板上方
      if (bubble && bubble.parentNode !== petLayer) petLayer.appendChild(bubble)
      if (debugEl) {
        petLayer.style.marginTop = '36px'
        syncDebugPanelWidth()
      }
      box.appendChild(petLayer)

      const M = PIXI.live2d?.Live2DModel
      if (!M) throw new Error('Live2DModel 不可用')

      app = new PIXI.Application({
        view: canvas,
        width: canvas.width,
        height: canvas.height,
        backgroundAlpha: 0,
        antialias: false,
        powerPreference: 'low-power',
      })
      try { app.ticker.maxFPS = maxFps } catch { /* 旧 ticker */ }
      syncTicker()

      const loaded = await new Promise<ModelLike>((resolve, reject) => {
        // from() loses the instance when textures fail after core creation.
        // fromSync returns it before either async setup callback can run.
        const pending = M.fromSync(url, {
          autoInteract: false,
          autoUpdate: false,
          onLoad: () => resolve(pending),
          onError: (error) => {
            // Vendor destroy() dereferences internalModel unconditionally;
            // an early JSON/setup failure has no Cubism core to release.
            if (pending.internalModel) {
              try { pending.destroy() } catch { /* 保留原始加载错误 */ }
            }
            reject(error)
          },
        })
      })
      if (disposed) {
        // The model was never added to the stage, so teardown cannot own it.
        loaded.destroy()
        teardownLayer()
        return
      }
      model = loaded
      syncTicker()
      // 基础尺寸：优先用模型实际包围盒（getBounds），拿不到再退回 loaded.width/height
      baseModelW = Number(loaded.width) || 0
      baseModelH = Number(loaded.height) || 0
      app.stage.addChild(loaded)
      try {
        const b = loaded.getBounds?.()
        if (b && b.width > 0 && b.height > 0) {
          baseModelW = b.width
          baseModelH = b.height
        }
      } catch { /* 包围盒不可用则保留 loaded.width/height */ }
      hitAreas = Object.keys(loaded.internalModel?.hitAreas ?? {})
      // 根据模型原始宽高自适应 canvas（size 视为可见宽度，受视口限制）
      const canvasSize = canvasSizeFor(renderedSizeFor(pos.size))
      canvas.width = canvasSize.width
      canvas.height = canvasSize.height
      try { app.renderer.resize(canvasSize.width, canvasSize.height) } catch { /* 旧渲染器 */ }
      if (zoneOverlay) {
        zoneOverlay.width = canvasSize.width
        zoneOverlay.height = canvasSize.height
        zoneOverlay.style.width = `${canvasSize.width}px`
        zoneOverlay.style.height = `${canvasSize.height}px`
      }
      syncDebugPanelWidth()
      // 动作真正播完信号：motion() 的 Promise 在开始时即 resolve，不能作为恢复/解除 focus 的时机
      const motionManager = loaded.internalModel?.motionManager
      if (motionManager?.on) {
        motionManager.on('motionFinish', handleMotionFinish)
        detachMotionFinish?.()
        detachMotionFinish = () => motionManager.off?.('motionFinish', handleMotionFinish)
      }
      refreshDebugMotionGroups()
      fitModel()
      // 绘制区域采样必须排在渲染之后：PIXI 把 render 挂在 LOW(-25)，
      // 用默认 NORMAL(0) 的回调会在首帧渲染前读到空帧缓冲（实测 alpha 全 0）。
      // 采样窗口覆盖待机动作的摆动极值：单帧包围盒会比后续姿态小，直接锁死会裁切模型。
      try {
        let dense = ART_SAMPLE_TICKS
        let tick = 0
        const measure = (): void => {
          if (disposed || model !== loaded) { detachArtMeasure?.(); return }
          const interval = dense > 0 ? ART_SAMPLE_EVERY : ART_WATCHDOG_EVERY
          if (dense > 0) dense -= 1
          if (tick++ % interval === 0) {
            const scaleNow = artScale > 0 ? artScale : baseModelW > 0 ? (pos.size - 8) / baseModelW : 0
            if (sampleArtBounds(scaleNow)) applySizeNow(pos.size)
          }
        }
        detachArtMeasure?.()
        // UTILITY(-50)：位于 PIXI 渲染（LOW）之后，读到的就是本帧画面。
        app.ticker.add(measure, undefined, TICKER_PRIORITY_UTILITY)
        detachArtMeasure = () => {
          detachArtMeasure = null
          try { app?.ticker.remove(measure) } catch { /* ticker 已销毁 */ }
        }
      } catch { /* 首帧适配 */ }
      // 指针命中探测：同样读渲染后的帧缓冲，据此决定画布是否拦截指针输入。
      try {
        detachHitProbe?.()
        app.ticker.add(probePointerHit, undefined, TICKER_PRIORITY_UTILITY)
        detachHitProbe = () => {
          detachHitProbe = null
          try { app?.ticker.remove(probePointerHit) } catch { /* ticker 已销毁 */ }
        }
      } catch { /* 命中探测不可用则保持整块拦截 */ }
      if (lastState) playState(lastState)
      if (showSpatialZones) startZoneLoop()

      // 指针事件（新 canvas；点击/拖动 6px 阈值）
      canvas.addEventListener('pointerdown', handlePointerDown)
      canvas.addEventListener('pointermove', handlePointerMove)
      canvas.addEventListener('pointerup', handlePointerUp)
      canvas.addEventListener('pointercancel', () => { down = null; dragging = false })
    } catch (error) {
      // 加载失败 → 静态头像（spec §7）；已卸载则不再展示。
      // 失败原因必须可见：静默降级会让“模型无法加载”无从排查。
      console.warn('[live2d-pets] 模型加载失败:', url, error)
      teardownLayer()
      if (!disposed) showFallback()
    }
  }

  /** 模型重载队列：串行执行，避免快速切换时并发加载。 */
  let modelLoadQueue: Promise<void> = Promise.resolve()
  function queueModelLoad(url: string | null): void {
    modelLoadQueue = modelLoadQueue.then(() => loadModelLayer(url)).catch(() => {})
  }

  /** 停止空间分区分帧重绘。 */
  function stopZoneLoop(): void {
    if (zoneRaf) { window.cancelAnimationFrame(zoneRaf); zoneRaf = 0 }
  }

  /** 绘制空间回退四档色块（与 spatialTap / classifyTapByPosition 一致）。 */
  function paintSpatialZones(): void {
    if (!showSpatialZones || !zoneOverlay || !canvas || !model) return
    const w = canvas.width
    const h = canvas.height
    if (!(w > 0 && h > 0)) return
    if (zoneOverlay.width !== w) zoneOverlay.width = w
    if (zoneOverlay.height !== h) zoneOverlay.height = h
    zoneOverlay.style.cssText = `position:absolute;left:0;top:0;width:${w}px;height:${h}px;pointer-events:none;z-index:2;display:block`
    const ctx = zoneOverlay.getContext('2d')
    if (!ctx) return
    ctx.clearRect(0, 0, w, h)
    let bounds: { x: number; y: number; width: number; height: number } | null = null
    try {
      const b = model.getBounds?.()
      if (b && b.width > 0 && b.height > 0) bounds = { x: b.x, y: b.y, width: b.width, height: b.height }
    } catch { /* 无包围盒 */ }
    if (!bounds) return
    const { x: bx, y: by, width: bw, height: bh } = bounds
    const fill = (color: string, x: number, y: number, rw: number, rh: number, label: string) => {
      if (!(rw > 0 && rh > 0)) return
      ctx.fillStyle = color
      ctx.fillRect(x, y, rw, rh)
      ctx.strokeStyle = 'rgba(255,255,255,.55)'
      ctx.strokeRect(x + 0.5, y + 0.5, rw - 1, rh - 1)
      ctx.fillStyle = 'rgba(255,255,255,.92)'
      ctx.font = '11px ui-monospace,monospace'
      ctx.fillText(label, x + 4, y + 14)
    }
    const rect = (minNx: number, maxNx: number, minNy: number, maxNy: number) => ({
      x: bx + bw * minNx,
      y: by + bh * minNy,
      w: bw * (maxNx - minNx),
      h: bh * (maxNy - minNy),
    })
    const head = rect(spatialTap.headMinNx, spatialTap.headMaxNx, 0, spatialTap.headMaxNy)
    const body = rect(spatialTap.bodyMinNx, spatialTap.bodyMaxNx, spatialTap.headMaxNy, spatialTap.legMinNy)
    const leg = rect(spatialTap.bodyMinNx, spatialTap.bodyMaxNx, spatialTap.legMinNy, 1)
    const armL = rect(spatialTap.armLeftMinNx, spatialTap.bodyMinNx, spatialTap.armMinNy, spatialTap.legMinNy)
    const armR = rect(spatialTap.bodyMaxNx, spatialTap.armRightMaxNx, spatialTap.armMinNy, spatialTap.legMinNy)
    fill('rgba(80,200,120,.22)', body.x, body.y, body.w, body.h, 'body')
    fill('rgba(80,160,255,.28)', head.x, head.y, head.w, head.h, 'head')
    fill('rgba(255,160,60,.28)', leg.x, leg.y, leg.w, leg.h, 'leg')
    fill('rgba(255,220,60,.32)', armL.x, armL.y, armL.w, armL.h, 'arm')
    fill('rgba(255,220,60,.32)', armR.x, armR.y, armR.w, armR.h, 'arm')
    ctx.strokeStyle = 'rgba(255,80,80,.85)'
    ctx.lineWidth = 1.5
    ctx.strokeRect(bx, by, bw, bh)
  }

  function startZoneLoop(): void {
    stopZoneLoop()
    if (!showSpatialZones) return
    const tick = () => {
      paintSpatialZones()
      zoneRaf = window.requestAnimationFrame(tick)
    }
    zoneRaf = window.requestAnimationFrame(tick)
  }

  function setSpatialZonesVisible(on: boolean): void {
    showSpatialZones = on
    if (zoneOverlay) zoneOverlay.style.display = on ? 'block' : 'none'
    if (on) startZoneLoop()
    else stopZoneLoop()
  }

  /** 调试面板的动画下拉同步（模型加载/切换时刷新选项）。 */
  function updateDebugMotionSelect(): void {
    if (!debugMotionSelect) return
    const previous = debugMotionSelect.value
    debugMotionSelect.textContent = ''
    if (debugMotionList.length === 0) {
      const opt = document.createElement('option')
      opt.value = ''
      opt.textContent = '（无动画或模型未加载）'
      debugMotionSelect.appendChild(opt)
      debugMotionSelect.value = ''
      return
    }
    const groups = [...new Set(debugMotionList.map((item) => item.group))]
    for (const group of groups) {
      const optgroup = document.createElement('optgroup')
      optgroup.label = group
      for (const item of debugMotionList) {
        if (item.group !== group) continue
        const opt = document.createElement('option')
        opt.value = `${item.group}\u0000${item.index}`
        opt.textContent = item.label
        optgroup.appendChild(opt)
      }
      debugMotionSelect.appendChild(optgroup)
    }
    if (debugMotionList.some((item) => `${item.group}\u0000${item.index}` === previous)) {
      debugMotionSelect.value = previous
    } else {
      debugMotionSelect.value = ''
    }
  }

  /** 从模型原生 .model3.json 拉取全部具体动画列表（不经过插件状态/映射逻辑）。 */
  async function refreshDebugMotionGroups(): Promise<void> {
    const url = currentModelUrl
    const currentModel = model
    if (!url || !currentModel) return
    const cached = motionListCache.get(url)
    if (cached) {
      if (model === currentModel && debugMotionSelect) {
        debugMotionList = cached
        updateDebugMotionSelect()
      }
      return
    }
    try {
      const res = await fetch(url)
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const data = await res.json() as {
        FileReferences?: { Motions?: Record<string, Array<{ File?: unknown } | unknown>> }
        Motions?: Record<string, Array<{ File?: unknown } | unknown>>
      }
      const motions = data?.FileReferences?.Motions ?? data?.Motions ?? {}
      const list: DebugMotionItem[] = []
      for (const [group, items] of Object.entries(motions)) {
        if (!Array.isArray(items)) continue
        items.forEach((motion, index) => {
          const file = typeof motion === 'object' && motion !== null && 'File' in motion
            ? String((motion as { File?: unknown }).File ?? index)
            : String(index)
          list.push({ group, index, label: `${group} / ${file}` })
        })
      }
      motionListCache.set(url, list)
      // 防止异步返回时模型/面板已经切换
      if (model !== currentModel || !debugMotionSelect) return
      debugMotionList = list
      updateDebugMotionSelect()
    } catch {
      // 原生 JSON 拉取失败时，退回到运行时 definitions（至少还能看到列表）
      const defs = currentModel.internalModel?.motionManager?.definitions ?? {}
      const list: DebugMotionItem[] = []
      for (const [group, motions] of Object.entries(defs)) {
        if (!Array.isArray(motions)) continue
        motions.forEach((motion, index) => {
          const file = typeof motion === 'object' && motion !== null && 'File' in motion
            ? String((motion as { File?: unknown }).File ?? index)
            : String(index)
          list.push({ group, index, label: `${group} / ${file}` })
        })
      }
      if (model !== currentModel || !debugMotionSelect) return
      debugMotionList = list
      updateDebugMotionSelect()
    }
  }

  /** debug 预览：直接播放模型原生指定动画（动作组 + 下标）。
   *  每次点击都 stopAllMotions 后重播，因此同一动画也可反复预览；
   *  预览期间抑制 focus，播完只恢复跟随，不触发状态动作恢复。 */
  function previewMotion(value: string): void {
    if (!model || !value) return
    const sep = value.indexOf('\u0000')
    if (sep < 0) return
    const group = value.slice(0, sep)
    const index = Number(value.slice(sep + 1))
    if (!Number.isInteger(index)) return
    const currentModel = model
    ++motionSeq // 作废旧预览/动作的异步回调，避免旧 motionFinish 释放新预览的焦点
    previewActive = true
    focusSuppressed = true
    currentModel.internalModel?.focusController?.focus(0, 0, true)
    currentModel.internalModel?.motionManager?.stopAllMotions?.()
    void currentModel.motion(group, index, MotionPriority.FORCE)
  }

  /** 让调试面板宽度与 canvas 同宽（canvas 尺寸变化/模型加载时同步）。 */
  function syncDebugPanelWidth(): void {
    if (!debugEl) return
    const w = canvas?.width ?? pos.size
    debugEl.style.width = `${w}px`
    debugEl.style.boxSizing = 'border-box'
  }

  /** 调试面板动态开关（spec §2）。 */
  function ensureDebugPanel(show: boolean): void {
    if (show && !debugEl && box) {
      debugEl = document.createElement('div')
      debugEl.style.cssText = 'pointer-events:auto;margin:6px 0 10px;padding:10px 12px;background:rgba(24,26,36,.94);color:#e8eaf0;border:1px solid rgba(128,128,128,.22);border-radius:10px;font:12px/1.5 ui-monospace,monospace;box-shadow:0 4px 16px rgba(0,0,0,.35)'

      const debugTitle = document.createElement('div')
      debugTitle.style.cssText = 'font-size:12px;font-weight:600;color:#aeb8cc;letter-spacing:.3px;margin-bottom:2px'
      debugTitle.textContent = '调试面板'
      debugEl.appendChild(debugTitle)

      const sectionLabel = (text: string): HTMLDivElement => {
        const el = document.createElement('div')
        el.style.cssText = 'margin:10px 0 4px;color:#7f8aa0;font-size:11px;font-weight:600;letter-spacing:.3px'
        el.textContent = text
        return el
      }

      // 状态演示：等宽按钮网格
      const demoLabel = sectionLabel('状态演示')
      debugEl.appendChild(demoLabel)
      const demoRow = document.createElement('div')
      demoRow.style.cssText = 'display:grid;grid-template-columns:repeat(5,1fr);gap:4px'
      for (const st of ['idle', 'thinking', 'waiting', 'done', 'error'] as const) {
        const btn = document.createElement('button')
        btn.textContent = st
        btn.style.cssText = 'padding:4px 0;border-radius:6px;border:1px solid rgba(128,128,128,.25);background:rgba(128,128,128,.1);color:#dbe2ef;font-size:11px;font-family:inherit;cursor:pointer;outline:none'
        btn.onmouseenter = () => { btn.style.background = 'rgba(120,170,255,.22)' }
        btn.onmouseleave = () => { btn.style.background = 'rgba(128,128,128,.1)' }
        btn.onclick = () => { demoState = demoState === st ? null : st; applyState(view) }
        demoRow.appendChild(btn)
      }
      debugEl.appendChild(demoRow)

      // 动画预览：原生动画下拉 + 播放按钮
      const motionLabel = sectionLabel('动画预览')
      debugEl.appendChild(motionLabel)
      const motionSelect = document.createElement('select')
      motionSelect.style.cssText = 'flex:1;min-width:0;background:#1c1e28;color:#e8eaf0;border:1px solid rgba(128,128,128,.3);border-radius:6px;font-size:12px;padding:4px 6px;outline:none'
      motionSelect.onchange = () => previewMotion(motionSelect.value)
      const motionPlay = document.createElement('button')
      motionPlay.textContent = '播放'
      motionPlay.style.cssText = 'padding:4px 12px;border-radius:6px;cursor:pointer;font-size:12px;font-family:inherit;background:rgba(120,170,255,.28);color:#e8eaf0;border:1px solid rgba(120,170,255,.35);outline:none'
      motionPlay.onmouseenter = () => { motionPlay.style.background = 'rgba(120,170,255,.4)' }
      motionPlay.onmouseleave = () => { motionPlay.style.background = 'rgba(120,170,255,.28)' }
      motionPlay.onclick = () => previewMotion(motionSelect.value)
      const motionRow = document.createElement('div')
      motionRow.style.cssText = 'display:flex;gap:6px;align-items:center'
      motionRow.appendChild(motionSelect)
      motionRow.appendChild(motionPlay)
      debugMotionSelect = motionSelect
      debugEl.appendChild(motionRow)

      // 状态信息：与上方区域分隔
      debugTextEl = document.createElement('div')
      debugTextEl.style.cssText = 'margin-top:10px;padding-top:8px;border-top:1px solid rgba(128,128,128,.18);color:#9aa5b8;font-size:11px;white-space:pre-wrap;word-break:break-all'
      debugEl.appendChild(debugTextEl)
      syncDebugPanelWidth()
      refreshDebugMotionGroups()
      // 调试面板放在 petLayer 之前：显示在 canvas 上方；气泡在 petLayer 上方，
      // 通过 petLayer margin-top 把气泡空间让出来，使顺序为 调试面板 → 气泡 → canvas
      if (petLayer) {
        box.insertBefore(debugEl, petLayer)
        petLayer.style.marginTop = '36px'
      } else {
        box.appendChild(debugEl)
      }
      applyState(view)
    } else if (!show && debugEl) {
      previewActive = false
      focusSuppressed = false
      debugEl.parentNode?.removeChild(debugEl)
      debugEl = null
      debugMotionSelect = null
      debugTextEl = null
      if (petLayer) petLayer.style.marginTop = ''
    }
  }

  /** 运行时应用配置变化（spec §2/§6/§7）：开关 / 尺寸 / 帧率 / 调试 / 分区 / 模型。 */
  function applyConfig(next: PetStateView): void {
    const cfg = next.config
    // 开关：显示/隐藏 + 暂停/恢复渲染循环（syncTicker 合并隐藏/失焦状态，spec §7）
    if (box) box.style.display = cfg.enabled ? '' : 'none'
    enabled = cfg.enabled
    keepAnimatingWhenInactive = cfg.keepAnimatingWhenInactive
    syncTicker()
    // 开发者总开关关闭时，调试面板与分区叠加均必须零渲染。
    ensureDebugPanel(cfg.developerMode && cfg.debug)
    setSpatialZonesVisible(cfg.developerMode && !!cfg.showTapZones)
    // 空间回退阈值：随当前模型解析结果热更新（自定义可覆盖；色块与分档共用）
    if (cfg.spatialTap) spatialTap = { ...cfg.spatialTap }
    // 动画映射：随当前模型解析结果热更新（自定义/内置可覆盖；缺省默认）
    if (cfg.motionMap) motionMap = { ...DEFAULT_MOTION_MAP, ...cfg.motionMap }
    // 帧率：立刻改 ticker.maxFPS（0 = 不限制）
    applyMaxFps(cfg.maxFps)
    // 尺寸：合并后重设画布 + 模型适配（避免连发 SSE 同步卡死主线程）
    scheduleSize(cfg.size)
    // 模型：modelUrl 变化 → 重载
    const nextUrl = cfg.modelUrl || null
    if (vendorsReady && nextUrl !== currentModelUrl) {
      currentModelUrl = nextUrl
      queueModelLoad(nextUrl)
    }
  }

  // ---- 指针：点击/拖动判定（6px 阈值，spec §4） ----
  let down: { x: number; y: number; startRight: number; startBottom: number } | null = null
  let dragging = false

  function handlePointerDown(e: PointerEvent): void {
    down = { x: e.clientX, y: e.clientY, startRight: pos.right, startBottom: pos.bottom }
    dragging = false
    canvas?.setPointerCapture(e.pointerId)
  }
  function handlePointerMove(e: PointerEvent): void {
    if (!down) return
    const dx = e.clientX - down.x
    const dy = e.clientY - down.y
    if (!dragging && Math.hypot(dx, dy) > DRAG_THRESHOLD) {
      dragging = true
      if (bubble) bubble.style.opacity = '0'
    }
    if (dragging && box) {
      pos = clampDisplay({
        right: down.startRight - dx,
        bottom: down.startBottom - dy,
        size: pos.size,
      })
      box.style.right = `${pos.right}px`
      box.style.bottom = `${pos.bottom}px`
    }
  }
  function handlePointerUp(e: PointerEvent): void {
    if (!down) return
    if (dragging) {
      void runtime.setDisplay({ right: Math.round(pos.right), bottom: Math.round(pos.bottom) }).catch(() => {});
      // 拖拽中隐藏的常驻气泡恢复当前阶段文案（spec §4：拖拽中暂停、结束恢复）
      showStageText()
    } else {
      handleTap(e)
    }
    down = null
    dragging = false
  }

  // ---- 鼠标跟随（spec §4）：全局 pointermove，头/眼/身体看向鼠标 ----
  function handleGlobalPointerMove(e: PointerEvent): void {
    lastPointerClient = { x: e.clientX, y: e.clientY }
    // 指针命中探测：记录画布内位置，渲染后判定该处是否有像素（决定是否放行点击）。
    if (canvas && !dragging) {
      const rect = canvas.getBoundingClientRect()
      if (rect.width > 0 && rect.height > 0
        && e.clientX >= rect.left && e.clientX <= rect.right
        && e.clientY >= rect.top && e.clientY <= rect.bottom) {
        // 换算到画布位图坐标（GL 原点在左下）
        const px = ((e.clientX - rect.left) / rect.width) * canvas.width
        const py = canvas.height - 1 - ((e.clientY - rect.top) / rect.height) * canvas.height
        pendingHitProbe = { x: px, y: py }
      }
    }
    // 非 idle 动作播放期间抑制 focus，避免动作关键帧被鼠标跟随叠加（spec §4）
    if (!model || !canvas || dragging || !enabled || hidden || focusSuppressed) return
    applyFocus(e.clientX, e.clientY)
  }
  function handleGlobalMouseOut(e: MouseEvent): void {
    // 仅当真正离开页面/窗口时复位；元素间移动会冒泡 mouseout，需排除 relatedTarget 非空
    if (e.relatedTarget) return
    lastPointerClient = null
    if (!model || dragging || !enabled || hidden) return
    // 非 idle 动作期间 focus 已被归零并抑制，不需要额外复位
    if (!focusSuppressed) {
      // 复位正视前方：FocusController 吃 [-1,1] 归一化目标，直接归零
      model.internalModel?.focusController?.focus(0, 0, true)
    }
  }

  function handleTap(e: PointerEvent): void {
    if (!canvas || !model) return
    const now = Date.now()
    if (now - lastTapAt < TAP_DEBOUNCE_MS) return
    lastTapAt = now
    try {
      const rect = canvas.getBoundingClientRect()
      const localX = e.clientX - rect.left
      const localY = e.clientY - rect.top
      // hitTest(x, y) 吃画布世界坐标（库内部做模型空间转换），返回命中的区域名数组
      const hits = model.hitTest(localX, localY)
      let bounds: { x: number; y: number; width: number; height: number } | null = null
      try {
        const b = model.getBounds?.()
        if (b && b.width > 0 && b.height > 0) bounds = { x: b.x, y: b.y, width: b.width, height: b.height }
      } catch { /* 无包围盒则仅按命中名 */ }
      const part = classifyTap(hits, localX, localY, hitAreas, bounds, spatialTap)
      if (part === null) return
      const poolKey = `tap${part[0].toUpperCase()}${part.slice(1)}` as 'tapHead' | 'tapLeg' | 'tapArm' | 'tapBody'
      const line = pickLine(activeCopy[poolKey], lastTapLine[poolKey])
      if (line !== undefined) {
        lastTapLine[poolKey] = line
        showBubble(line)
      }
      void playInteractionMotion(motionNamesFor(part))
    } catch {
      // 命中检测异常：忽略本次点击
    }
  }

  /**
   * 播放互动动作（摸头/点身体）：FORCE 可打断状态动画与上一次互动；动作真正播完
   * （motionFinish）后恢复当前状态动画（spec §4）。motion() 的 Promise 只代表开始，
   * 因此不再用 Promise 完成时间或 3s 兜底来恢复。
   */
  async function playInteractionMotion(names: readonly string[]): Promise<void> {
    if (!model || names.length === 0) return
    ++interactionGen
    await startMotionWithPriority(
      names,
      MotionPriority.FORCE,
      { suppressFocus: true, isInteraction: true },
    )
  }

  // ---- 主流程 ----
  void (async () => {
    try {
      // 1. 初始状态（配置 + 显示位置）
      await runtime.waitUntilReady();
      if (disposed) return;
      view = runtime.snapshot();
      pos = { ...view.display, size: view.config.size };

      // 2. Pointer-transparent anchor inside the host's viewport overlay.
      box = anchor;
      box.style.cssText = `position:absolute;inset:auto;top:auto;left:auto;right:${pos.right}px;bottom:${pos.bottom}px;margin:0;padding:0;border:none;background:transparent;width:auto;height:auto;overflow:visible;pointer-events:none`;
      // 恢复的坐标可能来自更宽的窗口/更早的版本：先钳制进当前视口。
      applyPosition();

      // 气泡层
      bubble = document.createElement('div')
      bubble.style.cssText = 'position:absolute;left:50%;bottom:100%;transform:translateX(-50%);margin-bottom:8px;padding:4px 10px;background:rgba(255,255,255,.95);color:#222;border-radius:999px;font:12px/1.5 sans-serif;white-space:nowrap;opacity:0;transition:opacity .2s;pointer-events:none'
      box.appendChild(bubble)

      // 窗口缩放后视口边界变化：重新按视口上限适配尺寸，并重新钳制位置（spec §4）。
      const onViewportResize = (): void => {
        if (dragging) return
        applySizeNow(pos.size)
        applyPosition()
      }
      window.addEventListener('resize', onViewportResize)
      pushCleanup(() => window.removeEventListener('resize', onViewportResize))

      // Subscribe before any asset await. Position, visibility and state must
      // remain reactive during loading and after a vendor/model failure.
      const handleState = (next: PetStateView): void => {
        if (disposed) return
        view = next
        // A runtime event must not replace unsaved coordinates mid-drag.
        // Rendering size stays local until applyConfig schedules its update.
        if (!dragging) {
          pos = clampDisplay({ right: next.display.right, bottom: next.display.bottom, size: pos.size })
          if (box) {
            box.style.right = `${pos.right}px`
            box.style.bottom = `${pos.bottom}px`
          }
        }
        applyConfig(next)
        applyState(next)
      }
      pushCleanup(runtime.subscribe(handleState))

      const onVisibility = () => { hidden = document.visibilityState !== 'visible'; syncTicker() }
      const onBlur = () => { hidden = true; syncTicker() }
      const onFocus = () => { hidden = false; syncTicker() }
      document.addEventListener('visibilitychange', onVisibility)
      window.addEventListener('blur', onBlur)
      window.addEventListener('focus', onFocus)
      pushCleanup(() => {
        document.removeEventListener('visibilitychange', onVisibility)
        window.removeEventListener('blur', onBlur)
        window.removeEventListener('focus', onFocus)
      })
      handleState(runtime.snapshot())

      // 3. Vendor scripts through the reviewed bundle asset bridge.
      for (const path of VENDOR_SCRIPTS) {
        await loadScript(runtime.bundleAssetUrl(path));
        if (disposed) return;
      }
      vendorsReady = true

      // 4. Initial and subsequent model loads share one queue, including
      // changes received while the first model is still loading.
      const initialUrl = view?.config.modelUrl || null
      currentModelUrl = initialUrl
      queueModelLoad(initialUrl)
      await modelLoadQueue
      if (disposed) return

      // 4.1 全局鼠标跟随（spec §4）：页面任意位置移动→头/眼/身体看向鼠标；
      //     鼠标移出页面→复位正视前方。监听挂在 document 上，模型重载时无需重绑。
      const onGlobalPointerMove = handleGlobalPointerMove
      const onGlobalMouseOut = handleGlobalMouseOut
      document.addEventListener('pointermove', onGlobalPointerMove, { passive: true })
      document.addEventListener('mouseout', onGlobalMouseOut)
      pushCleanup(() => {
        document.removeEventListener('pointermove', onGlobalPointerMove)
        document.removeEventListener('mouseout', onGlobalMouseOut)
      })

      // Reconcile with the latest snapshot rather than the pre-load view.
      handleState(runtime.snapshot())
    } catch (error) {
      // 静态头像降级（WebGL 不可用 / 模型加载失败，spec §7）
      if (!disposed) showFallback()
    }
  })()

  return () => { for (const fn of cleanup) { try { fn() } catch { /* 忽略清理错误 */ } } }
}

export function createPetOverlay(runtime: PetRuntime): (props: Record<string, never>) => ReactNode {
  return () => createElement(PetAnchor, { runtime });
}
