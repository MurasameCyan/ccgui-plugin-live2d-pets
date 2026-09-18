import { copyFileSync, mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";

const root = fileURLToPath(new URL(".", import.meta.url));

export default defineConfig({
  root,
  publicDir: "assets",
  plugins: [
    {
      name: "copy-plugin-manifest",
      closeBundle() {
        mkdirSync("dist", { recursive: true });
        copyFileSync("manifest.json", "dist/manifest.json");
      },
    },
  ],
  build: {
    outDir: "dist",
    emptyOutDir: true,
    target: "es2022",
    sourcemap: true,
    lib: {
      entry: "src/index.ts",
      formats: ["es"],
      fileName: () => "main.js",
    },
    rollupOptions: {
      external: [],
      output: {
        inlineDynamicImports: true,
      },
    },
  },
});
