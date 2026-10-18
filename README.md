# ds-h-v3 运行模型

[下载运行包 ZIP](https://github.com/MurasameCyan/ccgui-plugin-live2d-pets/releases/download/model-ds-h-v3-20261018/ds-h-v3-runtime.zip) · [SHA-256 校验值](https://github.com/MurasameCyan/ccgui-plugin-live2d-pets/releases/download/model-ds-h-v3-20261018/ds-h-v3-runtime.sha256) · [模型发布页](https://github.com/MurasameCyan/ccgui-plugin-live2d-pets/releases/tag/model-ds-h-v3-20261018) · [插件与完整说明](https://github.com/MurasameCyan/ccgui-plugin-live2d-pets/tree/main)

本分支只维护 ds-h-v3 运行资产及其发布配置，与插件 `main` 分支分开。运行包由 GitHub Actions 生成，解压后共 **30 个文件、40,868,786 字节（38.98 MiB）**：

- `ds-h-v3.model3.json` 模型入口。
- `ds-h-v3.moc3` 编译后的模型。
- `ds-h-v3.4096/` 中的 12 张贴图。
- `motions/` 中的 14 个动作文件。
- 物理配置与参数显示信息。

**不包含 CMO/CMO3、CAN3、PSD/PSB 源工程、制作素材、验证文件，也不包含插件或 Cubism Editor。** ZIP 是模型包，不是插件安装包。发布时校验全部入口引用，缺失文件或额外文件都会阻止打包。

## 使用

1. 下载 ZIP，解压并保留完整的 `ds-h-v3/` 目录，不要只复制入口文件。
2. 安装并启用 [Live2D 桌宠插件](https://github.com/MurasameCyan/ccgui-plugin-live2d-pets/releases/latest)。
3. 在插件「我的模型」中授权解压后的 `ds-h-v3/` 目录，入口填写 `ds-h-v3.model3.json`。
4. 思考槽位仅选择 `Working`，摸身体选择 `TapJump`，完成选择 `Done`；腿上沿设为 `0.82`。详见[中文 README](https://github.com/MurasameCyan/ccgui-plugin-live2d-pets/blob/main/README.md#配置自己的模型)与 [English README](https://github.com/MurasameCyan/ccgui-plugin-live2d-pets/blob/main/README.en.md#mapping-the-showcase-model)。

模型 Release 使用独立的 `model-ds-h-v3-…` 标签，不替换插件的 latest 发行版。更新运行文件时须为发布工作流设置新的 `MODEL_RELEASE` 标签；已发布版本不覆盖。

## 许可边界

插件代码的 MIT 许可不自动适用于本模型及其素材；使用和再分发须遵守素材权利人的授权。

## English

This branch distributes the **ds-h-v3 runtime model only**, separately from the plugin. Download the ZIP above, extract it, grant the plugin access to the complete `ds-h-v3/` directory, and use `ds-h-v3.model3.json` as the entry. The archive contains 30 runtime files: compiled model, textures, motions, physics, and display metadata. No editor projects, source artwork, validation files, plugin installation files, or Cubism Editor are included. The plugin's MIT license does not automatically license the model artwork.
