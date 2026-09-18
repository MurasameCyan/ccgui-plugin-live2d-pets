# CC GUI Live2D Pets

A Live2D companion plugin for CC GUI. It mirrors AI session state and provides per-body-part interaction, mouse tracking, draggable placement, persona lines, curated models, and developer diagnostics.

## Features

- Mirrors thinking, approval waiting, errors, completion, and idle states through the CC GUI runtime event hooks.
- Bundles fixed versions of PixiJS, Cubism Core, and pixi-live2d-display as reviewed plugin assets. Model files are never redistributed.
- Supports head, leg, hand, and body interaction. Incomplete HitArea metadata falls back to model-bounds zones.
- Tracks the pointer while the page is active; dragging, focus loss, hidden pages, and motion playback suppress tracking.
- Persists a draggable bottom-right position, size, and 30/60/unlimited ticker cap.
- Includes six personas and a private JSONC persona file with base inheritance.
- Includes five curated Live2D sample model URLs and user-defined remote or explicitly granted local models.
- Supports per-state and per-interaction motion-group mappings.
- Provides state demos, native motion preview, and tap-zone diagnostics behind developer options.
- Falls back to a static paw when WebGL or model loading fails.

## Install in CC GUI

Build the plugin and run the host's local plugin installer against `dist/`:

```bash
bun install
bun run validate
```

The output directory contains `manifest.json`, `main.js`, and the versioned `vendor/` runtime assets. Enable the plugin, then open CC GUI settings and select **Live2D Pets**.

## Development

```bash
bun install
bun run typecheck
bun run test
bun run build
bun run validate
```

`main.js` is a self-contained ESM bundle with the default `activate(ctx)` export. It uses only the injected `PluginContext`; it does not import React, Tauri, or CC GUI internals.

## Model access and permissions

- Curated models use `cdn.jsdelivr.net`, declared as an exact manifest network grant.
- A different remote host requires a matching `network:<host>` permission in `manifest.json` and a new release.
- Local models use the CC GUI asset-directory grant. Select a directory in settings, then enter the relative `.model3.json` path. The model's sibling assets are served through the same grant.
- Users remain responsible for the license terms of custom models.

## Storage

- Scalar settings and placement use the plugin's `ctx.storage` namespace.
- Personas and custom model definitions use the plugin's private `ctx.documentStorage` directory.
- Files are accessed only through SDK storage, bundled assets, and explicitly granted directories.

## License

Plugin code is MIT. Live2D Cubism Core, PixiJS, pixi-live2d-display, and the curated models remain subject to their upstream licenses and terms. Model files are loaded by URL and are not included in this repository.
