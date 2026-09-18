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
4. Ship the three vendor runtime scripts as reviewed bundle assets. Load them through `ctx.assets.bundleUrl`; never inject a remote script.
5. Load curated model URLs through `ctx.assets.remoteUrl`. Manifest grants `network:cdn.jsdelivr.net` exactly. Custom remote model hosts are rejected unless a future manifest grants them.
6. Replace arbitrary local filesystem paths and `/pet-local-models` with a user-selected asset directory grant plus a relative model path.
7. Keep model rendering and interaction in the overlay component. The host overlay container remains pointer-transparent outside the interactive canvas.
8. Register the settings icon as a React component through the SDK; do not mutate host settings DOM with a `MutationObserver`.
9. Keep the six personas, 13 speech pools, custom base inheritance, five curated models, spatial tap fallback, animation mapping, motion priority, focus suppression, completion hold, and visibility throttling.

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
