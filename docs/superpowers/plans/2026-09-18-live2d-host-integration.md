# Live2D 宿主 JS 集成验收计划

> **面向 AI 代理的工作者：** 使用 `executing-plans` 内联执行，保持测试、实现、复核检查点；生产代码修复必须先有失败回归。

**目标：** 补齐已接受 spec §1–4 的插件入口、真实宿主 SDK、overlay 及会话状态集成验证，定位并修复其中可复现的契约问题。

**架构：** 沿用 ADR-011，不增加产品功能。通过宿主 loader 已有的 `builtinActivate` 测试入口加载插件源码，保留真实 manifest 校验、PluginContext、注册表、hook 分发和 PluginOverlayHost；仅存储/IPC 后端与 vendor 渲染端点使用测试替身。不测试 blob bundle 导入、真实资产网络请求或原生 WebGL。

**技术栈：** TypeScript、Vitest、React 18、jsdom、宿主 SDK 0.4.3。

## 边界与落点

- 原宿主、原插件只读；继续在 `S:\AIWorker\desktop-cc-gui\ccgui-plugin-live2d-pets` 修改插件，保持父工作区既有改动。
- 宿主集成测试位于父工作区 `artifacts/live2d/`，通过 `LIVE2D_HOST_ROOT` 指定宿主源码；不把宿主内部依赖带入插件发布包。
- 不执行本地生产构建、提交、推送或 PR。当前 GitHub API 访问被网络策略拦截，CI 与真实模型验收单独保留。

## 任务 1：真实宿主集成基线

文件：父工作区 `artifacts/live2d/host-integration.test.tsx`、`artifacts/live2d/host-integration.config.mjs`。

- [x] 配置实际宿主与插件源码别名，共用宿主 React，测试目录与缓存写入限定在 artifacts。
- [x] 通过实际 manifest 和 `activate` 加载，断言 loader 状态、三个注册项、真实 overlay 容器及桥接后的 vendor / 模型 URL。
- [x] 通过真实命令注册表重置位置，验证 DOM 与按 pluginId 隔离的后端坐标；卸载/重载后保持设置且注册项不重复。
- [x] 通过真实 hook 分发验证 thinking → waiting → done → idle，并验证过期 turn 不污染当前状态。
- [x] 验证卸载移除 UI、注册项、模型和定时器；已排队的旧 hook 不再作用。

核心断言：

```ts
expect(getPluginState(manifest.id)).toBe("active");
await act(async () => commandRegistry.get(`plugin:${manifest.id}:reset-position`)!.run());
expect(anchor.style.right).toBe("24px");
expect(anchor.style.bottom).toBe("20px");
await act(async () => unloadPlugin(manifest.id));
expect(container.querySelector("[data-plugin-overlay-host]")).toBeNull();
```

## 任务 2：状态失效边界回归

文件：`src/runtime.test.ts`；仅在失败测试证明缺陷后修改 `src/runtime.ts`。

- [x] 验证会话关闭、恢复另一会话以及完成保持期结束后，旧 runtime / afterTurn 回调不重新激活桌宠；按真实宿主时序验证首轮开始后的创建事件不作废当前回合。
- [x] 若失败，先保存红灯输出，并定位 active turn 与 session reset 的真实状态转换。
- [x] 只修复已证明的失效边界；覆盖新 turn 仍正常驱动状态，避免加超时、取消或其它无关功能。

核心时序：

```ts
harness.getTurnHooks()?.onTurnStarted?.(turnEvent());
harness.getSessionHooks()?.onClosed?.(turnEvent());
harness.getTurnHooks()?.afterTurn?.({ ...turnEvent(), status: "completed" });
expect(runtime.snapshot().state).toBe("idle");
```

## 任务 3：复核与交接

文件：`docs/spec/live2d-pet-v01.md`、本计划、父工作区交接与补丁。

- [x] 运行完整插件 Vitest、类型检查、实际宿主集成和既有 SDK 定向回归。
- [x] 复核生产差异与失败测试，明确区分源码集成、blob 加载、CI 包和原生验收。
- [x] 更新行为规格和交接，重新导出补丁与校验值，并在原插件基线执行只读适用性检查。

验证命令（宿主工作树 cwd）：

```powershell
$env:LIVE2D_HOST_ROOT = 'S:/AIWorker/desktop-cc-gui-live2d'
node node_modules/vitest/vitest.mjs run --config 'S:/AIWorker/desktop-cc-gui/artifacts/live2d/host-integration.config.mjs' --configLoader native --pool=threads --no-cache
```

插件副本内：

```powershell
node --experimental-strip-types node_modules/vitest/vitest.mjs run --pool=threads --configLoader native --no-cache
bun run typecheck
```

## 证据与范围修正

- 初始集成 6 项中 1 项失败：关闭后迟到 `afterTurn(completed)` 将 idle 改为 done。日志：`host-integration-red.log`。
- 状态单元回归先出现 18 项预期失败；覆盖无活动回合的 6 个阶段 × 2 类回调，以及创建、恢复与跨会话关闭。日志：`runtime-session-red.log`。
- 宿主 `store.ts` 在发送前分发 `onTurnStarted`，`engine-events.ts` / send 返回后才分发 `onCreated`；因此未采用“一切会话事件都清空 turnId”的方案。
- 实现只增加跟踪回合的会话身份及精确过滤，不增加宿主权限；新会话 ID 在匹配引擎/工作区时补齐，恢复同一会话保留状态，关闭其它会话忽略。
- 修复后插件 49 项通过，类型检查退出码 0；真实宿主 JS 集成 8 项通过。最终复核及补丁检查另见交接记录。
