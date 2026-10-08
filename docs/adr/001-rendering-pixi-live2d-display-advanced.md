# ADR-001: Live2D 渲染选型 — pixi-live2d-display-advanced

## Status

Superseded by ADR-003

## Date

2026-08-14

## Context

- DSH 客户端插件运行环境为纯 JavaScript（无打包器/TS 编译）、React（createElement）、Slot 注册渲染
- v0.1 核心能力是**触摸互动**（摸头/点击命中）与**状态镜像**，开发时间应花在状态机与交互上，而非渲染样板代码
- 许可合规是硬约束：预设模型必须可再分发；SDK 按 Live2D 官方条款使用
- 预设模型生态：社区宽松许可模型绝大多数为 Cubism 4

## Decision

渲染层采用 **pixi-live2d-display-advanced（1.1.0，PixiJS v7）**，配合 **Cubism Core 4**（`live2dcubismcore.min.js`，按官方 SDK 使用条款引入），不采用原版 pixi-live2d-display（0.4.0，停更）。

选型依据（实测/已核实）：

| 维度 | 结论 |
|------|------|
| 集成成本 | UMD 直接 `<script>` 引入，零构建，契合纯 JS 客户端 |
| 触摸命中 | `model.hitTest('Head', x, y)` 一行 API，直接对应摸头/点击需求 |
| 自动眨眼/呼吸/物理/姿势 | 默认开启，桌宠"活人感"开箱即得 |
| 维护状态 | advanced 分支持续维护（AI-VTuber 生态在用）；原版 0.4.0 停更不可用 |
| 附加能力 | 并行动作、末帧保持、唇形同步——对"庆祝动画叠加待机"场景有用 |
| 许可 | MIT（Core 仍为 Live2D 专有许可，免费商用、需遵守版权声明等条款） |
| 模型版本 | Cubism 3/4；**不支持 Cubism 5**（见后果） |

## Alternatives Considered

### 备选方案 A：官方 Cubism Web Framework（v5）

- Pros: 官方持续维护；支持 Cubism 5（含新绑定特性）；无第三方渲染依赖；与官方文档/示例配套
- Cons: TS 源码需编译构建（纯 JS 环境多一条构建链）；触摸命中/动作管理为底层 API，样板代码多；v0.1 集成与迭代成本高
- Rejected: v0.1 优先交互手感与开发速度；保留为**升级备胎**（见 Consequences 触发条件）

### 备选方案 B：原版 pixi-live2d-display 0.4.0

- Pros: 社区经典、文档全、被 live2d-widget 生态广泛验证
- Cons: 已停更（PixiJS v6）；缺 advanced 分支的并行动作/末帧保持/唇形同步；后续无修复保障
- Rejected: 停更风险不可接受，同一代码库直接采用维护中的 advanced 分支

### 备选方案 C：裸 Cubism Core 自绘渲染

- Pros: 依赖最小、控制力最强
- Cons: 渲染循环、相机、纹理、命中检测全部自研，工作量爆炸
- Rejected: 与 v0.1 目标（快速出可玩原型）背道而驰

## Consequences

- 依赖链：PixiJS v7（MIT）+ pixi-live2d-display-advanced（MIT）+ Cubism Core（Live2D 专有许可，按条款使用）
- **预设模型必须选 Cubism 4 兼容**（社区宽松许可模型绝大多数是 4.x，影响可控）；预设定稿时需验证
- **触发切换官方框架的条件**：预设生态转向 Cubism 5 且需要其新特性（如 Pro 绑定）时，评估迁移——为降低迁移成本，状态机/交互层与渲染层保持接口隔离
- spike 待验证项：
  1. Cubism 5 编辑器导出的模型能否被 Core R4 加载（存疑）
  2. 脚本加载方式（CDN 引入 vs Host 托管静态资源）
  3. WebGL 在 DSH 客户端 Slot 环境可用性
