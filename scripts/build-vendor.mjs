import { fileURLToPath } from "node:url";
import { resolve } from "node:path";
import { build } from "vite";

const root = fileURLToPath(new URL("..", import.meta.url));

await build({
  configFile: false,
  root,
  publicDir: false,
  plugins: [
    {
      name: "keep-runtime-globals-external",
      enforce: "pre",
      resolveId(source) {
        if (/^(?:pixi\.js|pixi-live2d-display|@pixi\/[^/]+)(?:\/|$)/.test(source)) {
          this.error(`Vendor runtime must use type-only imports for ${source}; use the existing PIXI global at runtime`);
        }
        return null;
      },
    },
  ],
  build: {
    outDir: resolve(root, "dist/vendor"),
    emptyOutDir: false,
    target: "es2022",
    minify: "esbuild",
    lib: {
      entry: resolve(root, "vendor/live2d-runtime.ts"),
      name: "CCGUILive2DRuntime",
      formats: ["iife"],
      fileName: () => "live2d-runtime.js",
    },
    rollupOptions: {
      output: { inlineDynamicImports: true },
    },
  },
});
