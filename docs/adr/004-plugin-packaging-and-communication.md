# ADR-004: 原始 DSH 打包决策（历史记录）

## Status

Superseded by [ADR-011](011-ccgui-plugin-port.md).

## Scope

本文档记录 `dsh-live2d-pets` 原始 DSH 版本的 npm/Cordis bundle、Host route、SSE 和 DSH client module 决策。它不描述 CC GUI 的安装或运行时能力。

CC GUI 移植版使用根目录 `manifest.json`、Vite 生成的 `dist/main.js`、`PluginContext` hooks/storage/assets/overlay；详见 ADR-011。
