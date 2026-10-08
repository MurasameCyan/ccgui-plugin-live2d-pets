# CC GUI Live2D Pets

A Live2D companion plugin for CC GUI. It mirrors AI session state and provides per-body-part interaction, mouse tracking, draggable placement, persona lines, curated models, and developer diagnostics.

## Features

- Mirrors thinking, approval waiting, errors, completion, and idle states through the CC GUI runtime event hooks.
- Bundles fixed versions of PixiJS, the official Cubism 5.3 SDK for Web (R5, Core 06.00.0001), and pixi-live2d-display as reviewed plugin assets. Model files are never redistributed. The renderer requests a WebGL 2 context and falls back to WebGL 1; models using Cubism 5.3 blend modes or offscreen drawing require WebGL 2.
- Supports head, leg, hand, and body interaction. Incomplete HitArea metadata falls back to model-bounds zones.
- Tracks the pointer while the page is active; dragging, focus loss, hidden pages, and motion playback suppress tracking.
- Persists a draggable bottom-right position, size, and 30/60/unlimited ticker cap.
- Includes six personas and a private JSONC persona file with base inheritance.
- Includes five curated Live2D sample model URLs and user-defined remote or explicitly granted local models from the supported `.model3.json` (Cubism 3–5.3) format.
- Supports per-state and per-interaction motion-group mappings. Default candidates are tried in order; missing non-idle state motions no longer fall back to `Idle`.
  The default completion candidate is only `Done`, never `Jumping`; jumping can be explicitly mapped to an interaction slot.
- Provides repeatable state demos, native motion preview, and tap-zone diagnostics behind developer options. **Exit demo** immediately resumes the real session state; disabling diagnostics also exits the demo.
  The debug panel separates real state, demo state, current native motion, playback phase, and request phase. Candidate results remain available, while finish and automatic idle events update the live readout.
  Interaction and preview loading share start/finish ownership, so a stopped idle's late finish cannot cancel the first cold-loaded action.
  Drag its title bar to move the panel independently; the saved position is unaffected by pet movement or model size changes.
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
- Local models use the CC GUI asset-directory grant. Select a directory in settings, then enter the relative `.model.json` or `.model3.json` path. The model's sibling textures, moc/moc3, and motion assets are served through the same grant.
- Users remain responsible for the license terms of custom models.

## Storage

- Scalar settings and placement use the plugin's `ctx.storage` namespace.
- Personas and custom model definitions use the plugin's private `ctx.documentStorage` directory.
- Files are accessed only through SDK storage, bundled assets, and explicitly granted directories.

## License

Plugin code is MIT. Live2D Cubism Core, PixiJS, pixi-live2d-display, and the curated models remain subject to their upstream licenses and terms; the original notices ship beside the bundled assets. Model files are loaded by URL and are not included in this repository.
