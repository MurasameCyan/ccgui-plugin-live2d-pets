import { copyFileSync, mkdirSync, readdirSync, renameSync, rmdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";
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
        // Marketplace assets are installed flat. Keep the same layout in the
        // local package; source vendor files retain their upstream names.
        const vendor = resolve(root, "dist/vendor");
        for (const name of readdirSync(vendor)) {
          renameSync(resolve(vendor, name), resolve(root, "dist", `vendor-${name}`));
        }
        rmdirSync(vendor);
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
