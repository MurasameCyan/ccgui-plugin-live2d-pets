# CC GUI Live2D Pets 文档

本目录保留原始行为规格的可追溯结构，并记录 CC GUI 移植后的意图、边界与架构决策。

## 文档入口

| 主题 | 路径 |
| --- | --- |
| 产品意图 | `docs/intent/live2d-pet-plugin.md` |
| CC GUI 行为规格 | `docs/spec/live2d-pet-v01.md` |
| CC GUI 移植 ADR | `docs/adr/011-ccgui-plugin-port.md` |
| 其它架构决策 | `docs/adr/` |

## 开发纪律

- 用户可见行为变更同步 `spec`。
- 平台能力或数据流变更新增 ADR。
- 不复制 DSH Host/SSE 路由到 CC GUI；优先使用 `PluginContext` 能力。
