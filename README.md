# CC GUI Live2D Pets

CC GUI 的 Live2D 桌宠插件：镜像当前 AI 会话状态，支持分部位互动、鼠标跟随、拖动定位、完成庆祝、人设台词和自定义模型。

## 功能

- 状态镜像：思考、等审批、出错、完成、空闲；状态通过 CC GUI `runtime.events.read` hook 驱动。
- Live2D 渲染：PixiJS、Cubism Core、pixi-live2d-display 作为固定版本 bundle 资源随插件发布；模型文件不随插件分发。
- 互动：摸头、摸腿、摸手、点身体；HitArea 不完整时按模型包围盒分区回退；互动可打断当前动作并在结束后恢复。
- 鼠标跟随：页面内移动时模型跟随，拖动、失焦、隐藏或动作播放时暂停。
- 定位与性能：默认右下角、可拖动、位置持久化；40–400px 尺寸；30/60/不限制帧率；页面隐藏或窗口失焦时暂停 ticker。
- 人设：傲娇、元气、天然呆、三无、温柔治愈、病娇六套内置台词；插件私有 `personas.jsonc` 支持 JSONC、自定义人设和 base 继承。
- 模型：Hiyori、Haru、Mao、Mark、Natori 五条带许可信息的内置 URL 清单；自定义模型支持远程 URL 和用户明确授权目录中的本地 `.model3.json`。
- 动画映射：为状态和四种互动部位选择模型动作组；未配置槽位沿用默认候选链。
- 开发者选项：状态演示、原生动作预览、点击分区叠加。
- 加载失败降级为静态爪印，不影响 CC GUI 其它功能。

## CC GUI 安装

1. 构建本仓库：

   ```bash
   bun install
   bun run validate
   ```

2. 在 CC GUI 的插件设置中选择本地安装，指向 `dist/` 目录。`dist/` 包含：
   - `manifest.json`
   - `main.js`
   - `vendor/` 下的固定版本运行时脚本

3. 启用插件后，桌宠默认显示在右下角；设置入口为 CC GUI 设置中的「Live2D 桌宠」。

## 开发

```bash
bun install
bun run typecheck
bun run test
bun run build
bun run validate
```

`main.js` 是 CC GUI 插件 loader 的默认 ESM 入口。插件代码只依赖运行时注入的 `PluginContext`，不导入 React、Tauri 或 CC GUI 内部模块。

## 模型地址与权限

- 内置模型使用 `cdn.jsdelivr.net`，manifest 已声明该精确网络权限。
- 其它远程域名需要在 `manifest.json` 增加对应的 `network:<host>` 权限并重新发布；插件不会绕过宿主网络白名单。
- 本地模型不能读取任意 `file://` 路径。设置中点击「选择本地模型目录」，授权后填写目录内相对 `.model3.json` 路径；其余纹理和 moc3 文件通过同一个目录 grant 加载。
- 模型许可信息只对内置策展清单负责；自定义模型由用户自行确认来源和使用条款。

## 数据位置

- 标量设置和桌宠位置：CC GUI `ctx.storage` 的插件命名空间。
- 人设和自定义模型：CC GUI `ctx.documentStorage` 的插件私有目录，文件名分别为 `personas.jsonc`、`custom-models.jsonc`。
- 插件只能通过 SDK 的 document storage、bundle asset 和用户授权目录访问文件。

## 文档

- [产品意图](docs/intent/live2d-pet-plugin.md)
- [CC GUI 移植 ADR](docs/adr/011-ccgui-plugin-port.md)
- [架构决策](docs/adr/)

## 许可

插件代码采用 MIT。Live2D Cubism Core、PixiJS、pixi-live2d-display 及内置模型遵循各自上游许可和条款；内置模型只通过 URL 加载，不打包模型文件。
