# Live2D 模型来源设置续接计划

> **面向 AI 代理的工作者：** 使用 `executing-plans` 内联推进，先记录失败回归，再修复并验证；沿用 spec §2、§5 与 ADR-011，不增加模型来源或权限。

**目标：** 自定义模型在远程 URL 与已授权目录之间切换时，保存、动作预览及重新加载使用用户当前选择的来源；迟到的目录选择结果不覆盖已经变更或关闭的编辑器。

**架构：** 保持现有 `CustomModelEntry`、`PetRuntime` 与 SDK assets 接口。设置组件拥有草稿与目录选择请求的生命周期；远程候选不携带目录字段，手动修改地址使旧目录关联失效，但不撤销宿主持久化 grant。

**技术栈：** TypeScript、React 18、Vitest/jsdom、真实宿主 SDK 0.4.3 源码集成。

## 约束和证据

- 可写插件副本：当前工作区下 `ccgui-plugin-live2d-pets`；保留全部此前未提交修改。
- 原插件 `5f59de9` 与宿主 `feat/live2d-pets` / `de00ba821` 保持只读；不修改父工作区的 Rust 文件。
- 续接基线：49 项插件测试通过，`bun run typecheck` 通过。
- GitHub API 请求仍被网络策略拒绝；不运行本地生产构建、提交、推送或 PR，不把源码测试当作 CI 包或原生验收。
- 已观察到设置组件对远程输入保留 `directoryGrantId` / `directoryPath`，而 runtime 优先使用目录来源；先通过真实 React 输入和保存证明影响。

## 任务 1：复现与测试

文件：新增 `src/client/settings.test.ts`，复用 `src/test-context.ts`、真实 `PetRuntime` 与 `PetSettingsSection`。

- [x] 覆盖新建和编辑：已选目录后输入远程 URL，保存结果不再携带旧目录字段；当前模型与重载后的来源一致。
- [x] 验证未获许可的远程 URL 仍经过 `assets.remoteUrl`；手动改成本地路径不沿用原目录授权。
- [x] 验证正常目录添加、远程改目录、动作组预览和目录选择失败保留草稿。
- [x] 使用 deferred Promise 验证改地址、取消编辑、切换编辑对象和卸载后的旧目录回调；保存预期失败输出。

核心断言：

```ts
expect(saved.directoryGrantId).toBeUndefined();
expect(saved.directoryPath).toBeUndefined();
expect(runtime.snapshot().config.modelUrl).toBe(remoteUrl);
```

运行：

```powershell
node --experimental-strip-types node_modules/vitest/vitest.mjs run src/client/settings.test.ts --pool=threads --configLoader native --no-cache
```

## 任务 2：修复来源草稿

文件：`src/client/settings.ts`。

- [x] 在已证明的断点处理来源切换，避免改动渲染器、模型加载队列或宿主权限逻辑。
- [x] 目录选择只更新发起该请求且仍有效的编辑器；失效的成功和失败回调均不改 UI。
- [x] 对新建与编辑使用一致的失效规则，保留本地模型正常重命名及映射设置。
- [x] 定向回归、完整插件测试和类型检查通过。

## 任务 3：宿主与交付验证

文件：`artifacts/live2d/host-integration.test.tsx`（相对父工作区）、`docs/spec/live2d-pet-v01.md`、本计划及交接记录。

- [x] 使用实际宿主 `PluginContext` 验证目录来源改远程后的 URL 桥接、存储与权限拒绝；不替换宿主 URL / 权限实现。
- [x] 对生产差异、异步关闭和来源切换做独立审查；修复确定的本轮问题。
- [x] 更新 spec 与续接记录，重新导出全量续接补丁、SHA-256，并在原插件基线执行只读 `git apply --check --whitespace=error`。
- [x] 明确报告实际测试结果与仍未执行的 CI / 原生 WebGL 验收。

## 验证结果

- 新设置测试初次运行：15 项中 9 项按预期失败、6 项通过；生产修改前的日志为父工作区 `artifacts/live2d/settings-model-source-red.log`。
- 修复后这 15 项通过；独立审查后另补 6 项覆盖直接换编辑对象、添加/保存后的迟到结果与旧混合来源条目。
- 当前全套插件 70 / 70（6 个文件，含 21 项设置回归），类型检查通过。
- 真实宿主 JS 集成由 8 项增至 12 项并全部通过；保留原有 `builtinActivate`、存储/IPC 与 vendor 测试边界，实际 transport 在 jsdom 中走 Web 资产路由。
- 集成测试初次新增的失败来自夹具误设原生路径前缀、误计 overlay 初始化的动作列表请求；查明后修正测试的环境预期与测量起点，没有更改产品代码或放宽权限断言。
- 补审发现重载后的 `mock.lastCall` 可能取到旧加载记录；增加重载前清空记录及重载后恰好一次新调用断言，12 项宿主集成再次通过。
- 累计补丁在原插件 `5f59de9` 上只读适用性检查通过；原插件与宿主仍干净、HEAD 不变。生产构建、CI 包及原生模型验收保留为后续阶段。
