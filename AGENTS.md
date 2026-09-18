# ccgui-plugin-live2d-pets

CC GUI 的 Live2D 桌宠插件（从 dsh-live2d-pets 移植）。

## 必读文档

| 需求 | 文档 |
|------|------|
| 产品意图 | docs/intent/live2d-pet-plugin.md |
| 行为规格 | docs/spec/live2d-pet-v01.md |
| CC GUI 移植决策 | docs/adr/011-ccgui-plugin-port.md |

改用户可感知行为 → 同步 spec；改产品意图/范围 → 同步 intent；改架构/平台边界 → 新增或更新 ADR。

## 工程约定

- 依赖安装统一使用 `bun install`。
- 验证统一运行 `bun run validate`；它会执行 typecheck、Vitest、Vite 构建和产物/manifest 检查。
- `dist/` 是本地安装目录，不提交到 Git。
- 本插件只能通过 CC GUI `PluginContext` 访问 hooks、storage、documentStorage、assets 和 UI 扩展点；禁止 DSH Cordis、Host HTTP 路由、SSE、Tauri IPC 或任意文件 API。
