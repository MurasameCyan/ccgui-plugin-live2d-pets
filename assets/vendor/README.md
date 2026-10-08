# Bundled runtime assets

## Loading and build contract

Classic-script load order: `pixi.min.js`, `pixi-unsafe-eval.min.js`,
`live2d.min.js`, `live2dcubismcore.min.js`,
`live2d-display.cubism2.min.js`, then `live2d-runtime.js`.
The two Core globals are independent. The bundled display provides the
single shared Pixi Live2D model/factory for `.model.json` models; the
generated adapter registers the official Cubism 5.3 SDK for Web (R5) runtime
into that factory for Cubism 3-5.3 `.model3.json` models. The old Cubism 4
display is not shipped.

`vendor/live2d-runtime.ts` is the source entry, built by
`scripts/build-vendor.mjs` as a minified ES2022 IIFE at
`dist/vendor/live2d-runtime.js`. `bun run typecheck:vendor` checks the adapter,
vendored Framework and Core declarations independently from the plugin. The
vendor-only `vendor/tsconfig.json` disables `strictFunctionTypes` and
`useDefineForClassFields` for TypeScript compatibility with those upstream
declarations; no framework source is rewritten. `bun run build:vendor`
typechecks and builds the adapter; the normal plugin build invokes it after the
main build.
Pixi and pixi-live2d-display npm dependencies provide types only. Value imports
are rejected by the vendor build, preventing another Pixi or shared factory.

The 13 original GLSL files are embedded through Vite `?raw` imports; runtime
shader fetching is not required. The unsafe-eval adapter replaces generated
uniform synchronization with interpreted code. It does not enable `unsafe-eval`
or change the application's CSP. No SDK sample models, debug Core, Core source
map, or separate speculative WASM asset are bundled.

## Fixed upstream sources

### Cubism 5.3 SDK for Web R5 and Core 06.00.0001

Live2D designates R5 beta1 and later as the Cubism 5.3 SDK. `5-r.5`
(2026-04-02) is the latest Web Framework release tag at this pin.

- SDK: <https://cubism.live2d.com/sdk-web/bin/CubismSdkForWeb-5-r.5.zip>.
- ZIP SHA-256: `67064a7fb1812cf502f5c4a03bfe12cc638c75a621bb4acf06bb28763df06ba0`.
- Root: `CubismSdkForWeb-5-r.5/`.
- `Core/live2dcubismcore.min.js` is copied byte-for-byte to
  `assets/vendor/live2dcubismcore.min.js`.
- `Core/live2dcubismcore.d.ts`, `Core/LICENSE.md` and
  `Core/RedistributableFiles.txt` are retained under `vendor/cubism/Core/`.
- `Framework/src/**` (59 files), `Framework/Shaders/WebGL/**` (13 files), and
  `Framework/LICENSE.md` are copied byte-for-byte under
  `vendor/cubism/Framework/`.
- All 73 Framework files were byte-compared with the official
  [5-r.5 revision `198a3769c26ca3d7b600e932590433badd392edd`](https://github.com/Live2D/CubismWebFramework/tree/198a3769c26ca3d7b600e932590433badd392edd):
  no differences. The SDK's `cubism-info.yml` contains a different packaging
  hash; it is not used as the GitHub source revision.
- Framework tree SHA-256:
  `aec49197148f5352957e24d4443e4ff5a78c5c518365375d83382eea91bf56c5`.
  Computation: sort the 73 paths relative to `Framework/` in lexical order;
  concatenate UTF-8 `path + NUL + lowercase SHA-256(file bytes) + LF`, then
  SHA-256 that concatenation. This covers sources, shaders and the license.
- Core declaration SHA-256:
  `25fcaa2a6dfe311db95ad1795a2a7e6286d9192719df4e2c3e634915dc050334`.

Core is subject to the **Live2D Proprietary Software License**, not MIT.
`live2dcubismcore.LICENSE.md` and
`live2dcubismcore.RedistributableFiles.txt` retain the original notices in the
installable package. Framework and shader code are subject to the **Live2D Open
Software License**, with the original `cubism-framework.LICENSE.md` packaged
beside the generated adapter. These distinct licenses are not replaced by the
plugin's license. Applicable SDK release-license requirements, including the
classification of applications accepting user-supplied models, require review
before publication; technical packaging is not legal authorization.

### Pixi and the shared display runtime

- `live2d-display.cubism2.min.js`: unmodified
  [`pixi-live2d-display@0.4.0`](https://registry.npmjs.org/pixi-live2d-display/-/pixi-live2d-display-0.4.0.tgz),
  member `package/dist/cubism2.min.js`. Archive SHA-256:
  `60831e21bf7e53c0dc81a780fe2f5ba5157f790f316ab692de2d66b622d7dab5`;
  npm SHA-1: `f0628d1bb71765c042b85288344ef72d7b557fce`.
  Original MIT notice: `pixi-live2d-display.LICENSE`.
- `pixi.min.js`: retained PixiJS 6.5.10 asset, matching
  [`pixi.js@6.5.10`](https://registry.npmjs.org/pixi.js/-/pixi.js-6.5.10.tgz),
  member `package/dist/browser/pixi.min.js`, after CRLF-to-LF normalization
  only (the retained file has 9 CRLF line endings). It is not changed by this
  integration. Archive SHA-256:
  `f7830312c02742e1a29a31ac3ff3fdf3b264d8a772a0678b9a07a3b6d77474a0`.
  Original MIT notice: `pixi.LICENSE`.
- `pixi-unsafe-eval.min.js`: unmodified
  [`@pixi/unsafe-eval@6.5.10`](https://registry.npmjs.org/@pixi/unsafe-eval/-/unsafe-eval-6.5.10.tgz),
  member `package/dist/browser/unsafe-eval.min.js`. Archive SHA-256:
  `773984d5c671f8357e2c8a9cd573cd04a8adf508828fefadfe65215252e236cd`.
  Original MIT notice: `pixi-unsafe-eval.LICENSE`.

## SHA-256 inventory

These hashes were computed from the actual downloaded/copied bytes. They are
reproducibility checks, **not official signatures or license grants**. The
generated adapter hash is build-specific and is not an upstream asset hash.

| Packaged asset or notice | SHA-256 |
| --- | --- |
| `live2dcubismcore.min.js` | `8741f739779b5d5210872bd3d7d99f0f1e56e6c87409e7d26d6bb4b80aa1ef47` |
| `live2dcubismcore.LICENSE.md` | `b81e37048010ef1d336106151201a0323c3309cae44aecdedf57831fe88fa991` |
| `live2dcubismcore.RedistributableFiles.txt` | `d16c123688299e1e69a7f5ebc01b3bd75a8d408c024002a7d35b2aae94003f8c` |
| `cubism-framework.LICENSE.md` | `7ed849bff1e6499aa7cd882e47d246ddbbe06817c1e84cb974df949488302614` |
| `live2d.min.js` | `e4ea1f18bdd44b65394ffd5a1bab16982e88757d45134d1bd0737c8a6b3ddd08` |
| `live2d-display.cubism2.min.js` | `0e86a36540fb487d463904fc5e295316a3130dfc8ac345f37f29b34bed48bba3` |
| `pixi-live2d-display.LICENSE` | `8ccace668a041e78ed525d091b0b5daf8b623ff447f912616de535415e4f302f` |
| `pixi.min.js` (retained CRLF bytes) | `c651f3e6afb4ccaa87a236539605e059b3ab54045a0e4f5633a947bc34760511` |
| `pixi.LICENSE` | `536a16e090f0b6c1454a7c0b47ee8414a39a2f1724a154f10ca1edc750a2dcfd` |
| `pixi-unsafe-eval.min.js` | `94bb4bfdbd015087772ee03bc4117e253c326e8ca73a61646bd331b22f6847ad` |
| `pixi-unsafe-eval.LICENSE` | `ef9ae15b5a2b39f6e1445fb1e12ade9f000ebb19c173fb1e505879ba215d9c9d` |

All paths below are relative to `vendor/cubism/Framework/Shaders/WebGL/` and
retain the upstream Live2D copyright/license header.

| Original shader | SHA-256 |
| --- | --- |
| `fragshadersrcalphablend.frag` | `855b247f02042a808a41e282ee4d7de7cc4533abeb5032b4ab8fe84f7dec107f` |
| `fragshadersrccolorblend.frag` | `01d4bf6a14b4a738976e9a538767a21da0defa8816f3845a7df08a7713327538` |
| `fragshadersrccopy.frag` | `15c67a4ec3adda4c849aff2a8319a3f6aceef8a84d5e5e1f3fb7fd9cd681193c` |
| `fragshadersrcmaskinvertedpremultipliedalpha.frag` | `1005cff8113de587cf1c0e295288d04d85f0f4ebc223684c8340e017fd8fc788` |
| `fragshadersrcmaskpremultipliedalpha.frag` | `f84ff615393d26ea6ab7c28747803db6472524c92567c0ad01e8225fbab36a3b` |
| `fragshadersrcpremultipliedalpha.frag` | `c93abe215357cc782a25fc4ef20f5fe1f34e2cc193ee23d763b56b81fae5fce1` |
| `fragshadersrcpremultipliedalphablend.frag` | `2155076275199a2946959838391dfb856e9d1db91b6ca3abd19ed70d4ff27e15` |
| `fragshadersrcsetupmask.frag` | `3cccc0b68a56cfbf4bd4841b0a759431dd159812c38dc280981ba633fa0afe7a` |
| `vertshadersrc.vert` | `291ed3f35f71f1e71e6df33fb055f009a8a9b36ee664f74f24f6cefef0c4029b` |
| `vertshadersrcblend.vert` | `2589837bd7a6a550a1c3af41b4fa776011e6e71f2531320fa39afcb83b209bf4` |
| `vertshadersrccopy.vert` | `b7bc4ba7517f405af4812ac47d99bc2b633c99f463c1224029556b00e8dff3cf` |
| `vertshadersrcmasked.vert` | `6704a9df2e6d3ee5176c72fca4ba59358ba4827a07054b1e0a72a3c574e281fd` |
| `vertshadersrcsetupmask.vert` | `649aad2f6c0af55a7a4adcf33dbf78937ef9d77ed6ba917fd716176adce25afe` |
