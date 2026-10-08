# Live2D 桌宠（ccgui.live2d-pets）

CC GUI 视口插件：在界面上渲染一只可互动的 Live2D 桌宠，并镜像当前激活会话
的 AI 状态（思考 / 等审批 / 出错 / 完成 / 空闲）。摸头摸腿、鼠标跟随、拖动
停靠、人设台词、自定义模型与动画映射。

![桌宠在 CC GUI 界面右下角](docs/media/hero.jpg)

## 安装

宿主 → 设置 → 插件 → 从本地目录安装 → 选择构建出的 `dist/` 目录
（`manifest.json` / `main.js` / `vendor/` 所在处）。改代码后 `bun run build`
并在宿主里重载插件。

需要宿主 **Plugin SDK ≥ 0.3.20**（`ui:overlay` 视口挂载、资源桥
`assets:bundle` / `assets:directory`、回合开始 hook 与 `session://activated`
话题都在共通兼容线上）。仅应用版本号满足 `minAppVersion` 还不够。

## 显示与互动

- **状态镜像**：思考、等审批、出错、完成、空闲。状态由 `runtime.events.read`
  回合 hook 驱动，并**跟随当前激活会话**——切走再切回会恢复该会话的实时状态，
  后台会话的回合不会抢走表现。
- **互动**：摸头、摸腿、摸手、点身体。HitArea 不完整时按模型包围盒分区回退；
  互动可打断当前动作并在结束后恢复。
- **点击穿透**：指针按像素命中判定，模型透明处不拦截输入，点击与滚轮落到下方
  宿主组件。
- **鼠标跟随**：页面内移动时模型跟随；拖动、失焦、隐藏或动作播放时暂停。
- **定位**：默认右下角，可拖动并停靠视口四边。透明画布不形成强制留白，负锚点
  可持久化，松手、窗口缩放与重载后不回弹。命令面板「重置桌宠位置」回到右侧
  24px、底部 20px。
- **人设**：傲娇、元气、天然呆、三无、温柔治愈、病娇六套内置台词；插件私有
  `personas.jsonc` 支持 JSONC、自定义人设与 base 继承。

## 配置

宿主设置页 → 插件 → Live2D 桌宠，改完即生效。

| 配置 | 默认 | 说明 |
|---|---|---|
| 显示宠物 | 开 | 总开关；关闭后零渲染 |
| 窗口非激活时保持动态 | 关 | 忽略失焦/隐藏暂停，持续跑 ticker |
| 启用 Cubism 2.1 支持 | **关** | 加载 Cubism 2.1 legacy Core，用于 `.model.json` 旧模型。**该模式只私人本地使用**（见下方「Cubism 2.1 与许可」） |
| 尺寸 | 160px | 40–400px 主体尺寸 |
| 渲染帧率 | 30 | 30 / 60 / 不限制 |
| 人设 | 傲娇 | 内置六套 + 自定义 |

![桌宠配置卡：三个按钮开关、尺寸滑块与帧率档位](docs/media/settings-pet-config.png)

## 模型

- **内置**：Hiyori、Haru、Mao、Mark、Natori 五条带许可标注的 URL 清单，经
  `cdn.jsdelivr.net` 直载，模型文件不随插件分发。
- **自定义**：远程 URL（需在 manifest 增加对应 `network:<host>` 并重新发版，
  插件不绕过宿主网络白名单），或用户明确授权目录中的 `.model3.json`
  （Cubism 3–5.3）/ `.model.json`（Cubism 2.1，需开启上面的开关）。
- **动画映射**：为五种状态与四个互动部位选择模型动作组；未配置槽位按默认候选
  链顺序尝试。非待机状态缺动作时不回退 `Idle`；`done` 只尝试 `Done`。
- 本地模型不读任意 `file://`。设置里点「选择本地模型目录」授权后填目录内相对
  路径，纹理、moc/moc3 与动作资源走同一个目录 grant。

## 渲染栈

PixiJS 6.5.10、同版本 `@pixi/unsafe-eval`、官方 Cubism 5.3 SDK for Web（R5，
Core 06.00.0001）与 `pixi-live2d-display` 0.4.0 作为固定版本 bundle 资源随插件
发布。unsafe-eval 适配模块把 PIXI 生成式 uniform 同步换成解释执行，**不要求
放宽宿主 CSP**。渲染器优先请求 WebGL 2，不可用回退 WebGL 1；Cubism 5.3 混合
模式与离屏绘制需要 WebGL 2。加载失败降级为静态爪印，不影响宿主其它功能。

性能：默认 30fps 封顶（未封顶时 PIXI 可跑到 120–140fps）；页面隐藏或窗口失焦
暂停 ticker，重复配置更新不累加动画订阅；只暂停本模型的 shared-ticker 订阅，
不碰 `PIXI.Ticker.shared`。

## Cubism 2.1 与许可

「启用 Cubism 2.1 支持」默认关闭的原因是**许可，不是技术**。该 legacy SDK
（`live2d.min.js`，2.1.00_1）上游标注 CONFIDENTIAL，其许可只允许在接受
Live2D SDK 协议后放置于**自己控制的服务器**，再分发授权未取得（细节、来源
revision 与逐文件 SHA-256 见 [`assets/vendor/README.md`](assets/vendor/README.md)
的 publication gate）。开关关闭时整条 2.1 运行时不进页面；开启即视为自行确认
已持有适用许可、仅作本地私人使用。

五个内置模型全是 Cubism 4（`.model3.json`），走**可再分发**的 Cubism 5 Core
（`live2dcubismcore.RedistributableFiles.txt` 明文列出），不依赖 2.1。

## 数据位置

- 标量设置与桌宠位置：`ctx.storage` 的插件命名空间。
- 人设与自定义模型：`ctx.documentStorage` 的插件私有目录，文件名
  `personas.jsonc`、`custom-models.jsonc`。
- 插件只能通过 SDK 的 document storage、bundle asset 与用户授权目录访问文件。

## 开发

```bash
bun install
bun run typecheck   # tsc --noEmit
bun run test        # vitest：runtime / domain / client / settings
bun run build       # dist/ 产出 main.js + manifest.json + vendor/
bun run validate    # typecheck + test + build + 产物与 manifest 校验
```

`main.js` 是 CC GUI 插件 loader 的默认 ESM 入口。插件代码只依赖运行时注入的
`PluginContext`，不导入 React、Tauri 或 CC GUI 内部模块。

`Test and package plugin` 工作流在推送 main 时跑完整验证并上传安装 zip；
Actions artifact 配额耗尽时可手动运行选 `delivery: log`，在
`CCGUI_PLUGIN_ZIP_BEGIN` / `CCGUI_PLUGIN_ZIP_END` 之间输出 base64 zip 与
SHA-256。发版由 `release` 工作流在推送 tag（tag = manifest version）时产出
Release 附件。

## 文档

- [产品意图](docs/intent/live2d-pet-plugin.md)
- [CC GUI 移植 ADR](docs/adr/011-ccgui-plugin-port.md)
- [架构决策索引](docs/adr/)

## 许可

插件代码 **MIT**（见 [LICENSE](LICENSE)）。Live2D Cubism Core 按 Live2D
Proprietary Software License、Cubism Framework 与 shader 按 Live2D Open
Software License、PixiJS / `@pixi/unsafe-eval` / `pixi-live2d-display` 按 MIT，
原始通告随安装包一并分发。内置模型只经 URL 加载、不打包，按
[Live2D 示例模型条款](https://www.live2d.com/eula/live2d-sample-model-terms_cn.html)
使用（免费商用可，需标注著作权）。
