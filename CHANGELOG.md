# Changelog

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
