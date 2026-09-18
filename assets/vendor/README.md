# Bundled runtime assets

`pixi-unsafe-eval.min.js` is the unmodified browser bundle from
`@pixi/unsafe-eval@6.5.10`, matching the bundled PixiJS 6.5.10 runtime.

- Source: https://registry.npmjs.org/@pixi/unsafe-eval/-/unsafe-eval-6.5.10.tgz
- Package member: `package/dist/browser/unsafe-eval.min.js`
- License: MIT; retained in `pixi-unsafe-eval.LICENSE`.
- Load order: PixiJS, this adapter, Cubism Core, then pixi-live2d-display.

The adapter replaces generated uniform synchronization with interpreted code.
It does not enable `unsafe-eval` or change the application's CSP.
