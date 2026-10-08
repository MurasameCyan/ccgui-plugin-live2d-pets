# ADR-009: 自定义模型动画映射与 debug 动画预览

## Status

Accepted

## Date

2026-08-16

## Context

不同 Live2D 模型的 `Motions` 动作组差异很大：Mao 只有 `Idle` / `TapBody`，而插件默认状态映射写死了 `Thinking` / `Working` / `Jumping` 等组名。结果很多模型在状态切换时只能 fallback 到 `Idle`，表现为“只有气泡变化”。

需要让用户能把模型**实际拥有的动作组**挂到宠物状态/互动部位上，并在配置前先看到这些动画长什么样。

## Decision

1. **数据模型**：使用 `MotionMap = Partial<Record<AnimationSlot, string[]>>`，槽位为 5 个宠物状态 + 4 个互动部位；`DEFAULT_MOTION_MAP` 统一默认候选链，`done` 只含 `Done`，跳跃不作为默认完成动作。
2. **配置范围**：只有**自定义模型**在设置面板可编辑「动画映射」；内置 preset 由开发者在 `presets.jsonc` 预置 `animationMap`，用户不单独修改。
3. **解析动作组**：添加/编辑自定义模型时，打开「动画映射」即实时 `fetch` 该模型 `.model3.json`，从 `FileReferences.Motions`（或顶层 `Motions`）取动作组名列表。
4. **UI**：每个槽位一个多选下拉，选中项以 tag 展示；多选**不做排序**，触发时随机选一个播放；未配置槽位沿用 `DEFAULT_MOTION_MAP` 并按声明顺序兜底。
5. **解析失败**：仍允许保存自定义模型，映射区提示“无法解析动画列表，可稍后重试”，并提供重试。
6. **下发**：`PetService.snapshot()` 通过 `resolveMotionMap()` 计算当前模型生效映射，随 `config.motionMap` 经 SSE 下发 client。
7. **debug 预览**：调试面板列出模型原生全部具体动画（按动作组分组的文件列表），直接指定 group/index，以 FORCE 播放，不使用状态映射候选链。预览与互动共用 pending/start/finish 归属和焦点抑制，正常结束只恢复跟随；「退出演示」则立即恢复真实状态。

## Alternatives Considered

### 备选方案 A：内置预设也让用户改

- Pros：用户可完全自定。
- Cons：与“内置预置调好、开箱即用”的目标冲突，增加 UI 与维护成本。
- Rejected：用户已明确不需要。

### 备选方案 B：精确到具体动画文件

- Pros：最精确。
- Cons：配置复杂；当前 `model.motion()` 按组随机播放，动作组粒度已足够；改动大。
- Rejected：用户已确认按动作组。

### 备选方案 C：手动填写动作组名而非实时解析

- Pros：实现简单，不依赖网络/CORS。
- Cons：用户必须打开 `.model3.json` 看源码，体验差；与 debug 预览闭环脱节。
- Rejected：用户已确认实时解析。

## Consequences

- 自定义模型可按实际动作组配置状态/互动动画，解决“只有气泡变化”问题。
- 配置保存在 `$DSH_HOME/live2d-pet/custom-models.jsonc` 的 `models[].animationMap`，由 `CustomModelsStore` 读写，不再写入 settings.yaml。
- client 端播放逻辑从“固定候选链”改为“配置映射优先 + 默认兜底”：**只有被覆盖的槽位**才随机打乱后逐个尝试，避免选中组失效时完全无动作。
  下发的 `config.motionMap` 只含覆盖项；默认候选链不得与它合并，否则有序兜底链会被当成用户配置打乱，末位 `Idle` 会先启动并吞掉状态动作。
- debug 面板新增**全部具体动画**预览，便于用户逐条判断动画内容后再映射到动作组。
- 新增字段对旧 settings 文件向后兼容：缺省 `animationMap` 时沿用默认映射。
