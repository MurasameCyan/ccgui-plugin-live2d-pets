# ADR-008: Live2D 动作优先级与 focus 抑制规则

## Status

Accepted

## Date

2026-08-16

## Context

pixi-live2d-display 的 `MotionManager` 使用 `MotionPriority`（NONE=0 / IDLE=1 / NORMAL=2 / FORCE=3）控制动作能否打断当前动作：

- `IDLE` 只能在无动作时启动；
- `NORMAL` 不能打断 `NORMAL` 或 `FORCE`；
- `FORCE` 可以打断任意非“同 group + 同 index 正在播放”的动作。

原插件所有 `model.motion(name)` 都只传动作组名，走默认 `NORMAL` 优先级，导致：

1. 待机 `Idle` 以 `NORMAL` 播放后，若为 loop 型则 `currentPriority` 长期停在 2，后续 thinking/tap 等 `NORMAL` 请求被 `reserve()` 静默拒绝，动作实际播不出来；
2. `motion()` 的 Promise 在动作**开始**时即 resolve，不是播完信号，原“await 后恢复/3s 兜底”逻辑空转；
3. 库的 `FocusController` 有状态且每帧无条件注入头/眼/身体参数，动作播放时若不归零并门控 `pointermove`，摸头等动作会被鼠标转向叠加扭曲。

## Decision

统一动作启动与 focus 抑制规则：

- 待机动作：`MotionPriority.IDLE(1)`；
- 状态动作（thinking / waiting / done / error）与互动动作（TapHead / TapLeg / TapArm / TapBody）：`MotionPriority.FORCE(3)`；
- 启动状态/互动/原生预览前先作废旧播放归属，再 `stopAllMotions()`，以支持同动作重播；pending 请求与正在播放的动作分开记录；
- `model.motion()` 返回值按 `Promise<boolean>` 处理：`false`/异常都继续候选链，Promise 只结算启动结果，不能把已结束的短动作重新标记为 playing；
- `motionStart(group, index)` 为实际开始信号，绑定匹配的 pending 请求；自动 Idle 等无归属动作仍更新当前播放读数；
- 只有归属于当前请求的 `motionFinish` 才能解除抑制；互动结束后恢复当前状态，预览和状态动作结束后不主动重播。默认 Idle 若由库自动恢复，不重复发起相同请求；
- 非 idle 请求开始时 `focusController.focus(0, 0, true)` 归零，加载和播放期间都让全局 `pointermove` 跳过 focus 更新；所属动作完成或请求全部失败后解除抑制。

## Alternatives Considered

### 备选方案 A：状态动作用 NORMAL，只有互动用 FORCE

- Pros：更贴近库的“idle=NORMAL? 不，normal 是普通动作”的常规用法。
- Cons：`NORMAL` 不能打断 `NORMAL`，thinking/waiting 等长状态或 loop 动作会挡住后续 done/error 与阶段重播，不满足 spec“状态一变立即切换/阶段重播”。
- Rejected：无法闭环状态切换需求。

### 备选方案 B：继续用 `motion()` Promise + 定时器恢复

- Pros：改动小。
- Cons：Promise 不代表播完，恢复/兜底实际在动作开始时执行；遇到 `reserve()` 返回 `false` 时 fallback 失效，动作仍播不出。
- Rejected：根因未修。

### 备选方案 C：不显式 stopAllMotions，只靠 FORCE 打断

- Pros：大多数“换一个动作”场景可用。
- Cons：库对“同 group + 同 index 正在播放”的 motion 即使 FORCE 也拒绝启动，连点重播摸头、长状态阶段重播 thinking 仍无法实现。
- Rejected：无法满足重播需求。

## Consequences

- 状态/互动动作都能可靠打断待机与旧动作；状态切换和阶段重播可立即生效。
- 动作播放期间宠物不再被鼠标跟随“拽头”，互动动作姿态更干净。
- 需要维护 `motionSeq` 防异步 fallback 竞态：旧动作被 `stopAllMotions()` 打断后，其未完成的 Promise 不应继续启动候选。
- `motionFinish` 在库内部 `state.complete()` 前同步触发，恢复动作需延到微任务，避免重入修改 MotionState。
- `stopAllMotions()` 会重置 MotionState，但不清 MotionManager 的 `playing` 标志；下一帧仍可能发旧 `motionFinish`。发起请求时先清播放归属，避免这个事件恢复状态并清掉新动作的 reservation。
- 对后续开发：新增动作类型时按“idle=IDLE、必须立即展示=FORCE”归类；需要普通不打断状态的动作可再引入 NORMAL 档。
