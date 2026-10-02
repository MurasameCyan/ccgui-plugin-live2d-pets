# ADR-003: Live2D 渲染栈落地与 spike 验证结果

## Status

Accepted for the DSH runtime; superseded for the CC GUI port by ADR-011.

## Date

2026-08-14

## Context

- ADR-001 选定 pixi-live2d-display-advanced（1.1.0，PixiJS v7），但未实测其脚本加载方式
- 动态插件 spike（`petsp-1`）在 DSH 客户端实测了渲染能力，发现 advanced 1.1.0 的 dist 存在打包限制，与 ADR-001 的假设不符
- 需据实测结果修正渲染栈，并把 spike 已验证的结论固化为决策

## Decision

1. **v0.1 渲染栈（脚本直用路径，实测通过）**：
   - pixi-live2d-display **0.4.0**（`dist/cubism4.js` 单文件 UMD，224KB，无动态 import）
   - PixiJS **6.5.10**（`dist/browser/pixi.min.js`）
   - Cubism Core 4（`live2dcubismcore.min.js`；spike 用官方直链，生产随包 / Host 托管）
   - 通过 CDN `<script>` 注入加载（已验证可行）

2. **正式插件打包路径**：若走 `clientModules` bundle（有打包器），可回到 **advanced 1.1.0 ESM**（维护中、v7、并行动作 / 末帧保持 / 唇形同步等），打包器会解析其 chunk；脚本直用场景必须用 0.4.0 单文件。

3. **Host→Client 状态推送**：Client 用 `timer.interval` + `host.call('pet-state')` **轮询拉取**（已验证）；动态插件未暴露 Host→Client 事件桥，正式插件再评估更优通道。

## Spike 实测结果

| 项 | 结果 |
|----|------|
| WebGL 客户端可用 | ✅ WebGL 1.0 (Chromium) |
| DOM 访问 | ✅ `document` 可用 |
| CDN `<script>` 注入 | ✅ 可行 |
| CDN 脚本加载 | ✅ pixi / core / 插件均加载成功 |
| Host→Client 状态拉取 | ✅ `agent/status` seq 递增，轮询正常 |
| 模型加载 / 渲染 | ✅ Hiyori（Cubism 4）经 0.4.0 加载并渲染 |
| 动作 / 表情 | ✅ Idle 动作、Smile 表情播放 |
| 触摸命中 | ✅ 命中区名为 `Body`（模型自定义），点击触发 `TapBody`（pkg-5） |
| Cubism 5 模型兼容 | ⬜ 未验证 |

## 关键发现

- advanced 1.1.0 的 `dist/*.js` 被 esbuild 拆分成 chunk，**含动态 `import()`**；经 `<script>` 标签注入的经典脚本无法解析相对路径 chunk（按页面 URL 解析 → 404），导致模块只执行一部分——实测 `PIXI.live2d` 仅导出 `CubismConfig`，**`Live2DModel` 缺失**
- 原版 0.4.0 的 `dist/cubism4.js` 是**单文件 UMD**（无动态 import），可直接 script 引入；导出名为 `PIXI.live2d.Live2DModel`（PascalCase，实测确认）

## Alternatives Considered

- 官方 Cubism Web Framework：仍为 Cubism 5 升级备胎（同 ADR-001）
- advanced 1.1.0 脚本直用：实测不可行（chunk 拆分），除非先经打包器打成单文件
- `@naari3` / `mulmotion` 等维护分支：未实测，若需要维护中的单文件 UMD 可再评估

## Consequences

- v0.1 依赖链：PixiJS 6.5.10 + pixi-live2d-display 0.4.0 + Cubism Core 4
- 0.4.0 已停更（绑定 PixiJS v6）→ 锁定版本使用；升级 advanced 需引入打包器（见 Decision 2）
- 预设模型仍须 Cubism 4 兼容（不变）
- 状态推送为 1s 轮询（可调）；动态插件无原生事件桥
- 触摸 / 状态机 / 交互层与渲染层保持接口隔离，便于后续切换渲染栈
