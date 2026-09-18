# Changelog

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
