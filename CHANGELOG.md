# Changelog

## Unreleased

### Added

- Support Cubism 2.1 `.model.json` models alongside the existing Cubism 3–5.3 `.model3.json` path, including legacy motion metadata and the bundled legacy runtime assets.
- Drag the developer debug panel independently by its title bar. Its position is
  persisted separately from the pet coordinates, survives reopening and reloads,
  and stays within the viewport when the window or panel content changes size.
- Add an explicit **Exit demo** control; closing diagnostics also cancels demo overrides and resumes the real session state.

### Fixed

- Dock against the measured opaque-pixel rectangle rather than the authored canvas or animation-growth padding, while retaining the complete animation buffer.
- Preserve signed viewport offsets through saves, unrelated updates and reloads; restore the saved anchor after model warmup and viewport resizing instead of keeping an early temporary clamp.
- Preserve cold-loaded interaction and preview requests when a stopped idle emits a late finish. Playback ownership now begins at `motionStart`, and late start promises cannot revive completed actions.
- Avoid issuing a duplicate default idle request after the runtime has already reserved its automatic idle, preventing a spurious failed-request readout after a successful interaction.
- Use only `Done` as the default completion candidate instead of trying `Jumping` first. Explicit model mappings remain unchanged.
- Request a WebGL 2 context explicitly. Pixi 6.5.10 otherwise selects WebGL 1 whenever its user-agent check reports a mobile device, which prevents Cubism 5.3 blend-mode models from rendering.
- Drop the trailing `Idle` fallback from the `thinking` / `error` / `done` / `waiting`
  motion chains. A model without those groups previously played an idle motion
  instead, hiding the missing-group case behind ordinary idle animation.
- Try the built-in default motion candidates in declaration order. The resolved
  animation map previously carried the defaults as if they were user overrides, so the
  ordered chain was shuffled and a later candidate could start first and swallow the
  state motion.
- Bind the drawable vertex and opacity accessors to their owners when covering live mesh
  deformation. They are prototype methods on the bundled runtime, so the unbound
  references threw on first use and left the model canvas hidden.
- Settle a turn whose native session ID the host rekeys mid-turn. Turn-scoped events are
  now matched by their stable `turnId` first, and the new session ID is adopted into both
  the tracked turn and the active-session reference, so the pet no longer stays stuck at
  `thinking` for the rest of the turn.
- Mirror a terminal turn that started before the current runtime existed, which happens on
  plugin hot reload, re-enable, or a replaced overlay runtime. Completion and failure were
  silently discarded, leaving the pet at `idle`; turns already settled by this runtime stay
  ignored so late events cannot revive them.

### Changed

- Re-trigger the state on every developer-mode demo button click instead of toggling
  back to the previous state. Each click starts exactly one state motion, including
  the first click that changes the demo state.
- Separate real state, demo state, current native motion, playback phase, and request phase in the developer panel. Start, finish, preview, interaction, and automatic idle events refresh the readout; candidate chains and results remain request diagnostics rather than a stale current-motion label.

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
