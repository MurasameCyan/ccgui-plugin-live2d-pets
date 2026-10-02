# CC GUI Live2D Pets

CC GUI 的 Live2D 桌宠插件：镜像当前 AI 会话状态，支持分部位互动、鼠标跟随、拖动定位、完成庆祝、人设台词和自定义模型。

## 功能

- 状态镜像：思考、等审批、出错、完成、空闲；状态通过 CC GUI `runtime.events.read` hook 驱动，
  并且**跟随当前激活的会话**：切走再切回会恢复该会话的实时状态，后台会话的回合不会抢走表现。
- Live2D 渲染：PixiJS、同版本官方 `@pixi/unsafe-eval` CSP 适配模块、Cubism 2.1 legacy runtime、官方 Cubism 5.3 SDK for Web（R5，Core 06.00.0001）和 `pixi-live2d-display` 作为固定版本 bundle 资源随插件发布；模型文件不随插件分发。适配模块移除渲染路径对动态代码生成的依赖，不要求放宽宿主 CSP。渲染器优先请求 WebGL 2 上下文，不可用时回退 WebGL 1；使用 Cubism 5.3 混合模式或离屏绘制的模型需要 WebGL 2。
- 互动：摸头、摸腿、摸手、点身体；HitArea 不完整时按模型包围盒分区回退；互动可打断当前动作并在结束后恢复。
- 点击穿透：指针按像素命中判定，模型透明的部位不拦截输入，点击/滚轮落到下方宿主组件。
- 鼠标跟随：页面内移动时模型跟随，拖动、失焦、隐藏或动作播放时暂停。
- 定位与性能：默认右下角、可拖动、位置持久化；40–400px 主体尺寸，完整模型画布预留给动画，不按某一帧姿势裁切；画布超出视口时自动缩小，保证整只可见。
  30/60/不限制帧率；页面隐藏或窗口失焦时暂停 ticker，恢复及重复配置更新不会累加动画订阅。
- 人设：傲娇、元气、天然呆、三无、温柔治愈、病娇六套内置台词；插件私有 `personas.jsonc` 支持 JSONC、自定义人设和 base 继承。
- 模型：Hiyori、Haru、Mao、Mark、Natori 五条带许可信息的内置 URL 清单；自定义模型支持远程 URL 和用户明确授权目录中的 `.model.json`（Cubism 2.1）或 `.model3.json`（Cubism 3–5.3）。
- 动画映射：为状态和四种互动部位选择模型动作组；未配置槽位沿用默认候选链。
- 开发者选项：状态演示、原生动作预览、点击分区叠加。
- 加载失败降级为静态爪印，不影响 CC GUI 其它功能。

## CC GUI 安装

宿主需要 **Plugin SDK 0.3.17 或更高版本**（manifest 声明 `sdkVersion: ">=0.3.17"`）。该范围保留最低版本要求，允许后续更高版本通过握手，不再精确 pin。宿主仍须提供共通兼容线的 `ui:overlay`、资源桥和回合开始 hook；仅应用版本号满足最低要求还不够。跟随当前激活会话依赖宿主话题 `session://activated`（manifest 已声明 `events` 权限），缺少该权限的旧宿主仍可用，只是不再跟随会话切换。

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

在命令面板执行「重置桌宠位置」会立即回到距右侧 24px、底部 20px 的位置，并保存该位置，不改变尺寸设置。模型加载中或降级为爪印时，位置重置与显示开关同样生效。

## 开发

```bash
bun install
bun run typecheck
bun run test
bun run build
bun run validate
```

`main.js` 是 CC GUI 插件 loader 的默认 ESM 入口。插件代码只依赖运行时注入的 `PluginContext`，不导入 React、Tauri 或 CC GUI 内部模块。

GitHub Actions 的 `Test and package plugin` 工作流默认上传安装 zip。账号的 Actions artifact 配额耗尽时，可手动运行并选择 `delivery: log`：仍执行完整验证和 CI 构建，随后在 `Export installable plugin through CI logs` 步骤输出 SHA-256，以及 `CCGUI_PLUGIN_ZIP_BEGIN` / `CCGUI_PLUGIN_ZIP_END` 之间的 base64 zip 内容。解码下载后须与日志中的 SHA-256 比对；此方式不发布 Release。

## 模型地址与权限

- 内置模型使用 `cdn.jsdelivr.net`，manifest 已声明该精确网络权限。
- 其它远程域名需要在 `manifest.json` 增加对应的 `network:<host>` 权限并重新发布；插件不会绕过宿主网络白名单。
- 本地模型不能读取任意 `file://` 路径。设置中点击「选择本地模型目录」，授权后填写目录内相对 `.model.json` 或 `.model3.json` 路径；其余纹理、moc/moc3 文件和动作资源通过同一个目录 grant 加载。
- 模型许可信息只对内置策展清单负责；自定义模型由用户自行确认来源和使用条款。

修改模型地址会清除该草稿的旧目录关联：改填远程 URL 后，预览和保存按远程权限检查；手动改写本地目录文字后需重新选择目录。只修改名称或动画映射会保留原来源，切换草稿不会撤销其它模型可能共用的目录授权。

## 数据位置

- 标量设置和桌宠位置：CC GUI `ctx.storage` 的插件命名空间。
- 人设和自定义模型：CC GUI `ctx.documentStorage` 的插件私有目录，文件名分别为 `personas.jsonc`、`custom-models.jsonc`。
- 插件只能通过 SDK 的 document storage、bundle asset 和用户授权目录访问文件。

## 文档

- [产品意图](docs/intent/live2d-pet-plugin.md)
- [CC GUI 移植 ADR](docs/adr/011-ccgui-plugin-port.md)
- [架构决策](docs/adr/)

## 许可

插件代码采用 MIT。Live2D Cubism Core、PixiJS、pixi-live2d-display 及内置模型遵循各自上游许可和条款；内置模型只通过 URL 加载，不打包模型文件。Cubism 2.1 legacy runtime 的来源与再分发权限仍需权利人确认，公开发布前必须通过 `assets/vendor/README.md` 的 publication gate。
