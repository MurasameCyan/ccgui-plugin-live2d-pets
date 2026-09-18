# ADR-011: Port dsh-live2d-pets to the CC GUI Plugin SDK

## Status

Accepted for the CC GUI port.

## Context

The original plugin runs a DSH Host half and a DSH browser half. Its Host half owns Cordis events, HTTP routes, SSE, settings namespaces, JSONC files, absolute local paths, and a `/pet-assets` server. CC GUI plugins run as reviewed single-file ESM bundles behind `PluginContext`; they cannot call Tauri IPC, read arbitrary files, register Host HTTP routes, or mount DSH modules.

The CC GUI SDK provides the equivalent primitives needed for the user-visible behavior:

- `ctx.ui.registerOverlay` for persistent viewport placement.
- `ctx.ui.registerSettingsSection` and `ctx.ui.registerCommand`.
- `ctx.hooks.registerSessionHooks` and `ctx.hooks.registerTurnHooks` with normalized runtime events.
- `ctx.storage` for scalar preferences and display position.
- `ctx.documentStorage` for private CAS text files.
- `ctx.assets.bundleUrl`, `ctx.assets.remoteUrl`, and user-driven `ctx.assets.grantDirectory`/`directoryUrl`.

## Decision

1. Remove the DSH Host service, route, SSE, Cordis, settings namespace, and package patch layers.
2. Keep the client renderer and interaction state machine, replacing DSH state delivery with `PluginContext` hook callbacks.
3. Store settings in plugin KV and store `personas.jsonc` plus `custom-models.jsonc` in private document storage.
4. Ship the vendor runtime scripts as reviewed bundle assets. Load them through `ctx.assets.bundleUrl`; never inject a remote script. Load the matching official `@pixi/unsafe-eval` 6.5.10 adapter immediately after PixiJS: despite its name, it replaces generated uniform synchronization with interpreted code so rendering works without relaxing the host CSP.
5. Load curated model URLs through `ctx.assets.remoteUrl`. Manifest grants `network:cdn.jsdelivr.net` exactly. Custom remote model hosts are rejected unless a future manifest grants them.
6. Replace arbitrary local filesystem paths and `/pet-local-models` with a user-selected asset directory grant plus a relative model path.
7. Keep model rendering and interaction in the overlay component. The host overlay container remains pointer-transparent outside the interactive canvas.
8. Register the settings icon as a React component through the SDK; do not mutate host settings DOM with a `MutationObserver`.
9. Keep the six personas, 13 speech pools, custom base inheritance, five curated models, spatial tap fallback, animation mapping, motion priority, focus suppression, completion hold, and visibility throttling.
10. Require SDK `^0.4.3`, where overlays, the asset bridge and `onTurnStarted` are first available. An application version check alone does not establish these capabilities.

The overlay subscribes before loading vendor scripts or models so display controls also work during loading and fallback. Initial and replacement models use the same load queue. Each model's Cubism core is explicitly disposed, including models whose load completes after unmount; destroying the PIXI application alone does not destroy its stage children by default.

Use the bundled vendor's `fromSync` to retain the instance while asynchronous setup is pending. On setup failure, destroy a partially initialized instance only when its `internalModel` exists: the vendor's destroy method assumes that field is initialized. Successful instances transfer to the mounted-model lifecycle; late success and failure are released when setup settles, without creating UI after unmount. This does not introduce request cancellation or a load timeout.

Start model setup with `autoUpdate: false`, then synchronize that model's shared-ticker subscription with the overlay's visibility and enabled state. Stop the private Application ticker separately; never stop the global shared ticker, which may serve other consumers.

Track only turns observed through `onTurnStarted`, together with their engine, session ID and workspace path. The host can announce a new native session ID after its first turn starts, so that creation event updates the pending identity rather than resetting the pet. Session lifecycle matching prevents an unrelated close from cancelling the tracked turn; callbacks received after the tracked turn is released are ignored.

## Alternatives

### DSH compatibility server inside the plugin

Rejected. It would require unsupported Host routes, arbitrary filesystem access, and duplicated state transport. It would also violate the SDK's capability boundary.

### Inline all vendor libraries into `main.js`

Rejected. The vendor runtime is large and is already independently reviewable as fixed bundle assets. `assets:bundle` preserves a single plugin installation while keeping the executable entry small.

### Keep absolute local paths

Rejected. `file://` and arbitrary filesystem reads bypass the CC GUI asset grant. Directory grants preserve local-model support without weakening the sandbox.

### Mutate the settings DOM to restore the old paw icon

Rejected. The CC GUI SDK accepts an icon component directly; DOM mutation is brittle across host updates and violates clean unload behavior.

## Consequences

- All original user-facing functions have an SDK-native implementation.
- DSH-only API route/SSE behavior is intentionally gone; there is no second network server to maintain.
- Remote custom models need a manifest permission update; this is explicit and reviewable.
- Local model setup gains a one-time directory authorization step.
- The plugin can be installed, unloaded, and reloaded without host-specific global state.
