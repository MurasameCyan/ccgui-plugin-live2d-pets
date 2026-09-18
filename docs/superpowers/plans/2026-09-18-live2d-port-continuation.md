# Live2D 移植检查点续接计划

> **面向 AI 代理的工作者：** 使用 `subagent-driven-development` 分离 SDK 包契约与渲染器修复；每项先复现，再实现，再验证。

**目标：** 补齐检查点 `5f59de9` 中的位置重置与 SDK 最低版本，并保留宿主集成的明确验收边界。

**架构：** 沿用已接受的 ADR-011；PetRuntime 继续提供完整快照，overlay 负责将位置和配置同步到 DOM。订阅生命周期独立于异步 vendor/模型加载，拖动中的本地坐标不被无关状态快照覆盖。插件明确要求提供 overlay/assets/onTurnStarted 的 SDK 0.4.3。

**技术栈：** TypeScript、CC GUI PluginContext、React 18（测试宿主）、Vitest、jsdom。

## 已核实的基线与边界

- 宿主 `feat/live2d-pets` 为 `de00ba821`，SDK 版本 0.4.3，原工作树干净。
- 插件 `main` 为 `5f59de9`，原工作树干净；本轮修改在当前可写目录内的独立副本进行。
- 原 13 个测试通过；`bun run typecheck` 通过。
- 本轮 Git ref 写入及副本内 Vite 临时配置写入曾被沙盒拒绝；不提交、推送或改写原工作树。副本内 Vitest 使用原生配置加载并关闭缓存；标准 Bun 测试另在 `artifacts/live2d/lockfile` 验证镜像中执行。
- 本地不执行发布构建；保留 GitHub Actions 的 `bun run validate` 完整构建/产物校验入口。

## 任务 1：SDK 最低版本

文件：`manifest.json`、`scripts/validate.mjs`、`src/packaging.test.ts`。

- [x] 先增加最低 SDK 回归：`expect(manifest.sdkVersion).toBe("^0.4.3")`；确认旧 manifest 失败。
- [x] 将 manifest 与包验证脚本同步到 `^0.4.3`，保持全部现有权限。
- [x] 运行 packaging 测试；用宿主真实 `satisfiesSdkRange` 确认 0.4.0–0.4.2 拒绝，0.4.3 接受。

## 任务 2：位置同步和加载生命周期

文件：`src/client/index.ts`、`src/client/index.test.ts`、共享测试上下文、`package.json`、`bun.lock`。

- [x] 仅增加测试用 jsdom/React 依赖，离线更新锁文件，不把 React 引入生产入口。
- [x] 用真实 React 挂载 overlay、真实 PetRuntime 和受控 vendor/PIXI 边界构造回归：

  ```ts
  await runtime.setDisplay({ right: 180, bottom: 120 });
  await runtime.resetDisplay();
  expect(anchor.style.right).toBe("24px");
  expect(anchor.style.bottom).toBe("20px");
  ```

- [x] 确认拖动时宿主事件不覆盖实时坐标，松手保存最终位置；尺寸配置不因重置位置改变。
- [x] 确认 vendor 加载未结束、vendor 失败、模型失败时仍同步位置和显示开关；卸载后迟到回调不再生成 UI。
- [x] 先运行新增测试并记录预期失败，然后最小化修改：提前订阅快照，统一同步 DOM 位置；模型加载走同一串行队列并在创建 ticker 时同步启停状态。
- [x] 运行全部插件测试与类型检查。

## 任务 3：验收与交接

文件：`docs/spec/live2d-pet-v01.md`、`README.md`、ADR-011、续接记录及可回套补丁。

- [x] 同步用户可感知行为和宿主 SDK 需求，不把模拟渲染测试描述为真实 WebGL/Tauri 验收。
- [x] 独立审查位置、拖动、加载失败、卸载以及 SDK 契约，修复确定的问题。
- [x] 导出只包含本轮插件改动的补丁，验证它可应用到 `5f59de9`。
- [x] 核对原宿主与原插件工作树未变，记录实际通过项、未运行的 CI 构建与真实模型/原生宿主验收。

## 验证命令

```powershell
bun run typecheck
node --experimental-strip-types node_modules/vitest/vitest.mjs run --pool=threads --configLoader native --no-cache
git diff --check
```

## 2026-09-18 验证记录

- 插件：5 个文件、31 项测试通过，其中 18 项为真实 React / jsdom overlay 回归；`bun run typecheck` 退出码 0。
- 刷新验证镜像后，标准 `bun run test` 同样 31 项通过，标准 `bun run typecheck` 退出码 0；未运行发布构建。
- 宿主：真实 `feat/live2d-pets` 工作树的 asset-url、hooks、sdk-version、context 共 76 项定向测试通过。
- 审查发现的同帧尺寸反转、切模型残留拖动状态、共享 ticker 暂停及部分模型失败释放均已用回归覆盖。
- 真实插件源码与 bundled vendor JS 的 6 条生命周期探针通过；core / renderer 释放端点仍是计数替身，不代表原生堆或 GPU 验收。
- 完整离线安装未成功：Bun 缓存缺少部分依赖。验证使用已有依赖和本机缓存补齐的镜像，不宣称 clean install 已通过。
- CI 构建、产物校验、真实模型加载、原生 Tauri 安装/卸载及完整宿主交互验收继续保留为后续事项。
- 补丁：`artifacts/live2d/live2d-continuation.patch`（相对当前可写宿主目录），已在原插件基线执行 `git apply --check --whitespace=error`；原宿主与原插件仍干净且 HEAD 未变。
