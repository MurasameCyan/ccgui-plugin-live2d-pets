# CC GUI Live2D 桌宠

**给你的 AI，一个鲜活的伙伴。**

在 CC GUI 界面里放一只可互动的 Live2D 桌宠：跟随当前会话的思考、审批等待、出错、完成与空闲状态；支持摸头、摸手、摸腿、点身体、鼠标跟随、拖动停靠，以及自定义模型和人设。

[English](README.en.md) · [下载插件](https://github.com/MurasameCyan/ccgui-plugin-live2d-pets/releases/latest) · [下载 ds-h-v3 模型](https://github.com/MurasameCyan/ccgui-plugin-live2d-pets/releases/download/model-ds-h-v3-20261018/ds-h-v3-runtime.zip)

[![CC GUI Live2D 桌宠动态演示：思考、工作、等待、完成与触摸互动](https://raw.githubusercontent.com/MurasameCyan/ccgui-plugin-live2d-pets/main/docs/media/hero.gif)](https://raw.githubusercontent.com/MurasameCyan/ccgui-plugin-live2d-pets/main/docs/media/hero.mp4)

[观看高清 MP4](https://raw.githubusercontent.com/MurasameCyan/ccgui-plugin-live2d-pets/main/docs/media/hero.mp4) · 24 秒循环演示 · 无音轨

> 宣传图使用单独下载并导入的 **ds-h-v3** 模型，左侧为状态示意，并非真实任务录屏。模型文件不包含在插件安装包中；唱歌姿态、跳跃等效果由模型动作提供，需要相应的动画映射，并非所有模型都自带。

## 安装

1. 在 [Releases](https://github.com/MurasameCyan/ccgui-plugin-live2d-pets/releases/latest) 下载 `ccgui-plugin-live2d-pets-<版本>.zip` 并解压。
2. 在 CC GUI 中打开「设置 → 插件 → 从本地目录安装」，选择解压后**包含 `manifest.json`、`main.js` 与 `vendor-*.js` 的目录**。
3. 启用插件，在「Live2D 桌宠」设置页选择模型、尺寸和人设。

不需要本地编译；源码仓库根目录不是安装目录。需要主分支开发版本时，使用 [GitHub Actions](https://github.com/MurasameCyan/ccgui-plugin-live2d-pets/actions/workflows/package.yml) 的安装包。更新时安装同一插件 ID 的新目录即可；当前发行版本以 Releases 为准，主分支可能包含尚未发版的改动。

宿主与插件分别更新：安装新的 `self-build` 应用不会替换已安装的插件。出现旧的目录选择或多行模型表单时，从上述 Actions 下载新插件包并重新安装；更新后的表单为「名称｜模型路径（只读文本）｜浏览｜保存」。插件包只含运行代码、vendor 运行时与许可、README、图标和静态截图，宣传 GIF／MP4 与开发文档留在仓库，不随包安装。

市场安装与 ZIP 安装使用同一套扁平运行文件。Release 的 `vendor-*` 附件及第三方许可必须逐项登记在市场索引的 `sha256` 中；仅下载 `main.js` 与 `manifest.json` 不足以加载模型。旧版本索引未登记 vendor，需要安装完整 ZIP；新版本登记合并后才可从市场完整安装和升级。

需要宿主 **Plugin SDK ≥ 0.3.21**，提供 `ui:overlay`、资源桥、回合开始 hook、
`session://activated` 与文件选择并授权父目录的 `assets.grantFile`。
仅应用版本号满足 `minAppVersion` 还不够。

## 显示与互动

- **状态镜像**：思考、等审批、出错、完成、空闲。状态由 `runtime.events.read`
  回合 hook 驱动，并**跟随当前激活会话**——切走再切回会恢复该会话的实时状态，
  后台会话的回合不会抢走表现。
- **互动**：摸头、摸腿、摸手、点身体。HitArea 不完整时按模型包围盒分区回退；
  互动可打断当前动作；模型声明循环表演时，互动结束会恢复原动作组、原序号和暂停处的循环台词。
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
| 尺寸 | 160px | 40–400px 主体尺寸 |
| 渲染帧率 | 30 | 30 / 60 / 不限制 |
| 人设 | 傲娇 | 内置六套 + 自定义 |

右键桌宠可选择「打开调试菜单」，查看真实会话状态、状态演示、具体动画和命中分区。点击「退出演示」恢复真实会话；调试面板可独立拖动，位置会保存。

## 模型

- **内置**：Hiyori、Haru、Mao、Mark、Natori 五条带许可标注的 URL 清单，经
  `cdn.jsdelivr.net` 直载，模型文件不随插件分发。
- **自定义**：远程 URL（需在 manifest 增加对应 `network:<host>` 并重新发版，
  插件不绕过宿主网络白名单），或用户明确授权目录中的 `.model3.json`
  （Cubism 3–5.3）。
- **动画映射**：为五种状态与四个互动部位选择模型动作组；未配置槽位按默认候选
  链顺序尝试。非待机状态缺动作时不回退 `Idle`；`done` 只尝试 `Done`。
- 本地模型不读任意 `file://`。设置里点「浏览」，选择入口后自动授权
  其父目录并填入文件名；纹理、moc/moc3 与动作资源走同一个目录 grant。

### 下载 ds-h-v3 模型

[运行包 ZIP](https://github.com/MurasameCyan/ccgui-plugin-live2d-pets/releases/download/model-ds-h-v3-20261018/ds-h-v3-runtime.zip) · [SHA-256 校验值](https://github.com/MurasameCyan/ccgui-plugin-live2d-pets/releases/download/model-ds-h-v3-20261018/ds-h-v3-runtime.sha256) · [模型发布页](https://github.com/MurasameCyan/ccgui-plugin-live2d-pets/releases/tag/model-ds-h-v3-20261018) · [独立 models 分支](https://github.com/MurasameCyan/ccgui-plugin-live2d-pets/tree/models)

- 解压后 **30 个文件、40.87 MB（38.98 MiB）**：模型入口、MOC3、12 张贴图、14 个动作、物理配置与参数显示信息。
- **仅运行资产**；不上传 CMO/CMO3、CAN3、PSD/PSB 源工程、制作素材或验证文件。模型独立维护，不放进插件 `main` 分支或插件安装包。
- 下载后解压并保留完整的 `ds-h-v3/` 目录，再按下节导入；不要只复制 `.model3.json`。**模型 ZIP 不是插件安装包**，无需安装 Cubism Editor。
- 模型 Release 使用独立标签，不替换插件的 latest 发行版；ZIP 由 GitHub Actions 生成，附 SHA-256 校验值。

### 配置自己的模型

1. 在「我的模型」的一行表单中点「浏览」，选 `.model.json` 或 `.model3.json` 入口；同时允许插件读取其所在目录。
2. 名称为空时从文件名自动填入，已有名称保留且可修改。模型完整路径仅作为可选中文本显示，不需要填写；长路径省略显示，悬停可查看全文。确认后点「保存」并选用模型。
3. 编辑已有条目时点「修改」，同样只显示名称、路径、浏览和保存；取消文件选择不改变草稿，按 Escape 退出编辑。空间分区与动画映射等额外表单控件不再显示，已有配置保留；可通过「打开配置文件」编辑 `custom-models.jsonc` 中的 `spatialTap` / `animationMap`，远程模型地址也在该文件中配置。

以宣传图中的 ds-h-v3 为例：

| 设置项 | 示例映射 | 效果 |
| --- | --- | --- |
| 思考 | `Working` | 任务期间使用模型的工作／唱歌姿态 |
| 摸身体 | `TapJump` | 点击身体触发模型自带的单跳或双跳 |
| 完成 | `Done` | 完成时庆祝，不把跳跃默认当成完成动作 |

未覆盖 `thinking` 时，默认先播放 `Thinking`，最多 30 秒后进入 `Working` 并保持同一变体循环；互动或拖拽跨过截止点，会在结束后进入工作阶段。缺少可播放的 `Working` 时仍回退 `Thinking`。进入审批、完成或错误状态会结束旧的工作循环。

`animationMap` 中同一槽位的多个动作组是**候选组，不是顺序播放列表**。想从任务开始就使用 `Working`，将 `thinking` 设为 `["Working"]`；显式映射不会被默认阶段候选覆盖，也不要把同时配置 `Thinking` 和 `Working` 理解成先思考再工作的顺序指令。

若 ds-h-v3 的围裙点击被判成腿，可在配置文件中将 `spatialTap.legMinNy` 设为 `0.82`。这是该模型的校准值，不是其它模型的通用配置。可在已有自定义模型条目中合入以下字段，保留原有 ID、目录授权与其它配置：

```json
{
  "animationMap": {
    "thinking": ["Working"],
    "body": ["TapJump"]
  },
  "spatialTap": {
    "legMinNy": 0.82
  }
}
```

设置页保存后即生效。若直接编辑 `custom-models.jsonc`，需将插件禁用再启用以重新读取；不必重启整个 CC GUI。

### 模型自带循环台词

模型作者可在 `FileReferences.Motions` 的动作条目中添加 `CCGUI` 元数据：

```json
{
  "File": "motions/work.motion3.json",
  "CCGUI": {
    "Loop": true,
    "Lyrics": {
      "Duration": 8,
      "Cues": [{ "Time": 0, "Text": "First line" }, { "Time": 4, "Text": "Next line" }]
    }
  }
}
```

时间单位为秒，首条从 0 开始，后续时间递增且小于 `Duration`。歌词按顺序循环；
动作自然结束后续播同组同序号，点击互动结束也恢复原变体，歌词从暂停处继续。
切换真实状态或退出演示会取消旧表演。未声明元数据的模型保持原有行为；此字段不生成音频。

多姿态模型的命中区会按当前图层不透明度过滤：完全隐藏的姿态不参与部位优先级判断；显示后立即恢复命中，不需要重新加载模型。


## 渲染栈

PixiJS 6.5.10、同版本 `@pixi/unsafe-eval`、官方 Cubism 5.3 SDK for Web（R5，
Core 06.00.0001）与 `pixi-live2d-display` 0.4.0 作为固定版本 bundle 资源随插件
发布。unsafe-eval 适配模块把 PIXI 生成式 uniform 同步换成解释执行，**不要求
放宽宿主 CSP**。渲染器优先请求 WebGL 2，不可用回退 WebGL 1；Cubism 5.3 混合
模式与离屏绘制需要 WebGL 2。加载失败降级为静态爪印，不影响宿主其它功能。

性能：默认 30 fps，可选 60 fps 或不限制；页面隐藏或窗口失焦时默认暂停，除非开启「窗口非激活时保持动态」。重复配置更新不累加动画订阅；仅暂停本模型的 shared-ticker 订阅，不停止其它消费者使用的全局 ticker。

## 数据位置

- 标量设置与桌宠位置：`ctx.storage` 的插件命名空间。
- 人设与自定义模型：`ctx.documentStorage` 的插件私有目录，文件名
  `personas.jsonc`、`custom-models.jsonc`。
- 插件只能通过 SDK 的 document storage、bundle asset 与用户授权目录访问文件。

## 开发

```bash
bun install --frozen-lockfile
bun run typecheck   # tsc --noEmit
bun run test        # runtime / domain / client / settings
```

构建与打包交给 GitHub Actions：CI 中的 `bun run validate` 执行类型检查、测试、构建及产物校验。安装使用 CI 或 Release 产物，不把源码目录当成成品目录。

`main.js` 是 CC GUI 插件 loader 的默认 ESM 入口。插件代码只依赖运行时注入的
`PluginContext`，不导入 React、Tauri 或 CC GUI 内部模块。

`Test and package plugin` 工作流在推送 main 时跑完整验证并上传安装 zip；
Actions artifact 配额耗尽时可手动运行选 `delivery: log`，在
`CCGUI_PLUGIN_ZIP_BEGIN` / `CCGUI_PLUGIN_ZIP_END` 之间输出 base64 zip 与
SHA-256。发版由 `release` 工作流在推送 tag（tag = manifest version）时产出
Release 附件。

## 文档

- [产品意图](https://github.com/MurasameCyan/ccgui-plugin-live2d-pets/blob/main/docs/intent/live2d-pet-plugin.md)
- [CC GUI 移植 ADR](https://github.com/MurasameCyan/ccgui-plugin-live2d-pets/blob/main/docs/adr/011-ccgui-plugin-port.md)
- [架构决策索引](https://github.com/MurasameCyan/ccgui-plugin-live2d-pets/tree/main/docs/adr/)

## 许可

插件代码 **MIT**（见 [LICENSE](LICENSE)）。Live2D Cubism Core 按 Live2D
Proprietary Software License、Cubism Framework 与 shader 按 Live2D Open
Software License、PixiJS / `@pixi/unsafe-eval` / `pixi-live2d-display` 按 MIT，
原始通告随安装包一并分发。内置模型只经 URL 加载、不打包，按
[Live2D 示例模型条款](https://www.live2d.com/eula/live2d-sample-model-terms_cn.html)
使用（免费商用可，需标注著作权）。

单独分发的 ds-h-v3 模型及素材不自动适用插件代码的 MIT 许可；使用和再分发须遵守素材权利人的授权。
