# CC GUI Live2D Pets

**Give your AI a lively companion.**

A Live2D pet inside the CC GUI viewport. It follows the active AI session and supports body-part interactions, pointer tracking, draggable placement, persona dialogue, custom models, and motion mappings.

[简体中文](README.md) · [Download the plugin](https://github.com/MurasameCyan/ccgui-plugin-live2d-pets/releases/latest) · [Download ds-h-v3](https://github.com/MurasameCyan/ccgui-plugin-live2d-pets/releases/download/model-ds-h-v3-20261018/ds-h-v3-runtime.zip)

[![CC GUI Live2D Pets: animated state and interaction showcase](https://raw.githubusercontent.com/MurasameCyan/ccgui-plugin-live2d-pets/main/docs/media/hero.gif)](https://raw.githubusercontent.com/MurasameCyan/ccgui-plugin-live2d-pets/main/docs/media/hero.mp4)

[Watch the full-resolution MP4](https://raw.githubusercontent.com/MurasameCyan/ccgui-plugin-live2d-pets/main/docs/media/hero.mp4) · 24-second loop · No audio

> The showcase uses the separately imported **ds-h-v3** model. The UI and state timing are illustrative, not a recording of a live AI task. Model files are not bundled with the plugin. Singing poses and jumps require matching model motions and mappings; they are not universal model features.

## Features

- Mirrors thinking, approval waiting, errors, completion, and idle states through the CC GUI runtime event hooks.
- Bundles fixed versions of PixiJS, the official Cubism 5.3 SDK for Web (R5, Core 06.00.0001), and pixi-live2d-display as reviewed plugin assets. Model files are not bundled in the plugin installation package. The renderer requests a WebGL 2 context and falls back to WebGL 1; models using Cubism 5.3 blend modes or offscreen drawing require WebGL 2.
- Supports head, leg, hand, and body interaction. Incomplete HitArea metadata falls back to model-bounds zones.
- Tracks the pointer while the page is active; dragging, focus loss, hidden pages, and motion playback suppress tracking.
- Persists a draggable bottom-right position, size, and 30/60/unlimited ticker cap.
- Includes six personas and a private JSONC persona file with base inheritance.
- Includes five curated Live2D sample model URLs and user-defined remote or explicitly granted local models from the supported `.model3.json` (Cubism 3–5.3) format.
- Supports per-state and per-interaction motion-group mappings. Default candidates are tried in order; missing non-idle state motions no longer fall back to `Idle`.
  The default completion candidate is only `Done`, never `Jumping`; jumping can be explicitly mapped to an interaction slot.
- Right-click the pet to open or close the debug menu. Developer options provide state demos, native motion previews, and tap-zone diagnostics. **Exit demo** immediately resumes the real session state; disabling diagnostics also exits the demo.
  The debug panel separates real state, demo state, current native motion, playback phase, and request phase. Candidate results remain available, while finish and automatic idle events update the live readout.
  Interaction and preview loading share start/finish ownership, so a stopped idle's late finish cannot cancel the first cold-loaded action.
  Drag its title bar to move the panel independently; the saved position is unaffected by pet movement or model size changes.
- Falls back to a static paw when WebGL or model loading fails.

## Install in CC GUI

1. Download `ccgui-plugin-live2d-pets-<version>.zip` from [Releases](https://github.com/MurasameCyan/ccgui-plugin-live2d-pets/releases/latest) and extract it.
2. In CC GUI, open **Settings → Plugins → Install from local directory** and select the extracted directory containing **`manifest.json`, `main.js`, and `vendor/`**.
3. Enable the plugin and open its **Live2D Pets** settings to choose a model, size, and persona.

No local build is required. The source repository root is not an installable plugin directory. For the current development version, use the package from [GitHub Actions](https://github.com/MurasameCyan/ccgui-plugin-live2d-pets/actions/workflows/package.yml). Install an updated directory with the same plugin ID to update the plugin. Releases are the published versions; `main` may contain unreleased changes.

The host and plugin update separately: installing a new `self-build` application does not replace an installed plugin. Install the updated Actions plugin package if the old directory picker or multi-line form remains. The new form contains only **Name | Model path (read-only text) | Browse | Save**. Installation packages include code, vendor runtimes and notices, READMEs, the icon, and static artwork only. Promotional GIF/MP4 files and development documentation remain online, outside the installation package.

The host must provide **Plugin SDK ≥ 0.3.21**, including `assets.grantFile`, in addition to satisfying the manifest's minimum application version.

## Development

```bash
bun install --frozen-lockfile
bun run typecheck
bun run test
```

Build and packaging run in GitHub Actions. CI invokes `bun run validate` for type checking, tests, the build, and artifact validation; install the resulting CI or Release package.

`main.js` is a self-contained ESM bundle with the default `activate(ctx)` export. It uses only the injected `PluginContext`; it does not import React, Tauri, or CC GUI internals.

## Model access and permissions

- Curated models use `cdn.jsdelivr.net`, declared as an exact manifest network grant.
- A different remote host requires a matching `network:<host>` permission in `manifest.json` and a new release.
- Local models use the CC GUI asset-directory grant. Click **Browse** to select a `.model.json` or `.model3.json` file; its parent directory is granted. The single-row form shows an editable name, the complete path as selectable read-only text, Browse, and Save. Empty names are derived from the filename; existing names remain editable. Long paths are ellipsized with the complete path in a hover tooltip. Confirm with **Save**; cancelling the picker leaves the draft unchanged. Escape exits an existing model's editor. Sibling textures, moc/moc3, and motion assets use the same grant.
- Directory and relative-filename inputs, spatial controls, and motion-mapping controls are no longer shown. Existing `spatialTap` and `animationMap` data remain unchanged when renaming or browsing for a replacement model. Configure those overrides and remote model URLs through **Open configuration file** (`custom-models.jsonc`).
- Users remain responsible for the license terms of custom models.

### Download the ds-h-v3 model

[Runtime ZIP](https://github.com/MurasameCyan/ccgui-plugin-live2d-pets/releases/download/model-ds-h-v3-20261018/ds-h-v3-runtime.zip) · [SHA-256 checksum](https://github.com/MurasameCyan/ccgui-plugin-live2d-pets/releases/download/model-ds-h-v3-20261018/ds-h-v3-runtime.sha256) · [Model release](https://github.com/MurasameCyan/ccgui-plugin-live2d-pets/releases/tag/model-ds-h-v3-20261018) · [Separate models branch](https://github.com/MurasameCyan/ccgui-plugin-live2d-pets/tree/models)

- **30 files, 40.87 MB (38.98 MiB) unpacked**: model entry, compiled MOC3, 12 textures, 14 motions, physics, and display metadata.
- **Runtime assets only.** No CMO/CMO3, CAN3, PSD/PSB editor projects, source artwork, or validation files are uploaded. Model assets are kept off the plugin's `main` branch and out of its installation package.
- Extract the ZIP and keep the complete `ds-h-v3/` directory. In **My models**, click **Browse**, choose `ds-h-v3.model3.json`, allow access to its parent directory, then confirm the filled name with **Save**. Do not copy just the entry file. **This ZIP is a model, not a plugin installer**; Cubism Editor is not required.
- GitHub Actions creates the ZIP and checksum. The model has a separate release tag and does not replace the plugin's latest release.

### Mapping the showcase model

For ds-h-v3, configure **Thinking → `Working`** to use its work/singing poses during a task, **Body → `TapJump`** for jumping, and **Done → `Done`** for completion in `custom-models.jsonc`. Multiple groups in one `animationMap` slot specify candidates, not a sequential playlist; configuring both `Thinking` and `Working` does not mean “play Thinking once, then Working.”

If the apron is classified as legs, set the spatial zone's leg boundary (`legMinNy`) to `0.82`. This calibration is specific to ds-h-v3. Merge the following fields into its existing custom-model entry without replacing its ID, directory grant, or unrelated settings:

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

Changes saved through settings take effect immediately. After directly editing `custom-models.jsonc`, disable and re-enable the plugin to reload the document; restarting CC GUI is unnecessary.

Model authors can add `CCGUI: { Loop: true, Lyrics: { Duration: 8, Cues: [{ Time: 0, Text: "First line" }, { Time: 4, Text: "Next line" }] } }` to an entry in `FileReferences.Motions`. Times are seconds, starting at zero and increasing within `Duration`. Lyrics loop in order. Natural completion and touch recovery retain the selected group and index; touch and rendering pauses also pause the lyric clock. A new state or Exit demo cancels the old performance. Ordinary models are unchanged, and this metadata does not generate audio.

Hit areas on fully transparent pose layers do not participate in body-part selection. Their current opacity is checked at each click, so a newly visible pose becomes interactive without reloading the model.


## Storage

- Scalar settings and placement use the plugin's `ctx.storage` namespace.
- Personas and custom model definitions use the plugin's private `ctx.documentStorage` directory.
- Files are accessed only through SDK storage, bundled assets, and explicitly granted directories.

## License

Plugin code is MIT. Live2D Cubism Core, PixiJS, pixi-live2d-display, and the curated models remain subject to their upstream licenses and terms; the original notices ship beside the bundled assets. Curated sample models are loaded by URL and are not bundled with the plugin. The separately distributed ds-h-v3 model and artwork are not automatically covered by the plugin's MIT license; usage and redistribution must comply with the rights holder's authorization.
