# Changelog

## Unreleased

### Added

- Support Cubism 2.1 `.model.json` models alongside the existing Cubism 3–5.3 `.model3.json` path, including legacy motion metadata and the bundled legacy runtime assets.

### Fixed

- Request a WebGL 2 context explicitly. Pixi 6.5.10 otherwise selects WebGL 1 whenever its user-agent check reports a mobile device, which prevents Cubism 5.3 blend-mode models from rendering.

## [1.0.5] - 2026-10-01

### Fixed

- Let the visible model pixels dock to all four viewport edges while keeping transparent safety padding outside the viewport.
- Apply the same visible-edge bounds to dragging, restored positions, and viewport resizing without changing the saved size.

## [1.0.4] - 2026-10-01

### Fixed

- Anchor the speech bubble to the model's visible bounds instead of the transparent canvas top.
- Move the bubble below the model when the top edge has insufficient room, and clamp its horizontal center inside the viewport.
- Recalculate bubble placement after text, model motion, mouse-follow, physics, resize, and model replacement without changing model or drag coordinates.

## [1.0.3] - 2026-09-30

### Fixed

- Cover live Cubism mesh deformation beyond the authored canvas, including motion, mouse-follow, and physics; grow the drawing buffer and repaint in the same frame.
- Compensate canvas growth against the original anchor instead of moving the model; retain expanded coverage when a pose returns to idle. Viewport limits still take precedence when space runs out.
- Resolve pointer hit probes against the current canvas geometry after expansion, and remove the mesh coverage listener on model replacement or unload.

## [1.0.2] - 2026-09-30

### Fixed

- Preserve the full authored model canvas after visible-width calibration instead of cropping to the initial pose.
- Fit the complete animation canvas against both viewport dimensions without changing the saved size preference.
- Make model ticker transitions idempotent; repeated configuration, runtime, and focus events no longer accumulate subscriptions and accelerate animation.
- Stop warmup readback after revealing the model instead of continuously sampling a frozen layout.

## [1.0.0] - 2026-09-18

### Added

- CC GUI `PluginContext` activation with persistent overlay, settings section, command, runtime hooks, plugin storage, document storage, bundle assets, and directory grants.
- Self-contained `main.js` build plus fixed vendor assets under `dist/vendor/`.
- Local model support through explicit asset-directory grants.
- Runtime, settings-helper, model, persona, and packaging regression checks.

### Changed

- Ported the original DSH Host/SSE implementation to the CC GUI SDK without changing the user-visible Live2D interaction model.
- Replaced DSH absolute paths and HTTP routes with SDK-scoped storage and assets.

### Removed

- DSH Cordis bundle patch, Host HTTP routes, SSE endpoint, and arbitrary filesystem access.
