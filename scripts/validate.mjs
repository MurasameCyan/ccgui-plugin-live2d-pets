import { existsSync, readFileSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";

const root = fileURLToPath(new URL("..", import.meta.url));
const manifest = JSON.parse(readFileSync(resolve(root, "manifest.json"), "utf8"));
const requiredPermissions = [
  "storage",
  "plugin.storage",
  "ui:settings-section",
  "ui:overlay",
  "ui:command",
  "session.lifecycle.read",
  "runtime.events.read",
  "events",
  "assets:bundle",
  "assets:directory",
  "network:cdn.jsdelivr.net",
];

if (!/^[a-z0-9][a-z0-9-]*(?:\.[a-z0-9][a-z0-9-]*)*$/.test(manifest.id)) throw new Error(`invalid plugin id: ${manifest.id}`);
if (!/^\d+\.\d+\.\d+$/.test(manifest.version)) throw new Error(`invalid plugin version: ${manifest.version}`);
const minimumSdk = typeof manifest.sdkVersion === "string"
  ? manifest.sdkVersion.match(/^>=(\d+\.\d+\.\d+)$/)
  : null;
if (!minimumSdk) {
  throw new Error(`sdkVersion must declare a >=x.y.z minimum, got ${JSON.stringify(manifest.sdkVersion)}`);
}
// The mirror describes the minimum supported contract, not an exact host pin.
// Keep its capability surface in sync while allowing newer host versions.
const sdkSource = readFileSync(resolve(root, "src/sdk.ts"), "utf8");
const sdkStamp = sdkSource.match(/@ccgui\/plugin-sdk mirror v(\d+\.\d+\.\d+)/);
if (!sdkStamp) throw new Error("src/sdk.ts is missing its `@ccgui/plugin-sdk mirror v<x.y.z>` stamp");
if (sdkStamp[1] !== minimumSdk[1]) {
  throw new Error(`src/sdk.ts stamp v${sdkStamp[1]} != minimum SDK ${minimumSdk[1]}`);
}
const expectedContextKeys = [
  "pluginId", "version", "react", "hooks", "documentStorage", "assets",
  "shell", "ui", "theme", "i18n", "storage", "events", "host",
].sort();
const ctxOpen = sdkSource.indexOf("export interface PluginContext {");
if (ctxOpen < 0) throw new Error("src/sdk.ts does not declare `export interface PluginContext`");
const ctxKeys = new Set();
let ctxDepth = 0;
let ctxSeen = false;
for (const raw of sdkSource.slice(ctxOpen).split("\n")) {
  if (ctxSeen && ctxDepth === 1) {
    const member = raw.match(/^\s{2}([A-Za-z][A-Za-z0-9]*)\??\s*[:(]/);
    if (member) ctxKeys.add(member[1]);
  }
  for (const ch of raw) {
    if (ch === "{") { ctxDepth++; ctxSeen = true; }
    else if (ch === "}") { ctxDepth--; }
  }
  if (ctxSeen && ctxDepth === 0) break;
}
const ctxMissing = expectedContextKeys.filter((k) => !ctxKeys.has(k));
const ctxExtra = [...ctxKeys].filter((k) => !expectedContextKeys.includes(k));
if (ctxMissing.length || ctxExtra.length) {
  throw new Error(
    `PluginContext top-level keys drifted from the frozen mirror.` +
      (ctxMissing.length ? ` missing: ${ctxMissing.join(", ")}.` : "") +
      (ctxExtra.length ? ` unexpected: ${ctxExtra.join(", ")}.` : ""),
  );
}
for (const permission of requiredPermissions) {
  if (!manifest.permissions.includes(permission)) throw new Error(`manifest missing permission: ${permission}`);
}

const mainPath = resolve(root, "dist/main.js");
const main = readFileSync(mainPath, "utf8");
if (Buffer.byteLength(main) > 2 * 1024 * 1024) throw new Error("main.js exceeds 2 MiB");
for (const [relativePath, bundle] of [
  ["dist/main.js", main],
  ["dist/vendor/live2d-runtime.js", readFileSync(resolve(root, "dist/vendor/live2d-runtime.js"), "utf8")],
]) {
  for (const pattern of [/window\.__TAURI__/i, /\beval\s*\(/i, /new\s+Function\s*\(/i, /import\s*\(\s*["'`]https?:/i]) {
    if (pattern.test(bundle)) throw new Error(`forbidden bundle pattern in ${relativePath}: ${pattern}`);
  }
}
const source = readFileSync(resolve(root, "src/sdk.ts"), "utf8");
for (const required of [
  "registerOverlay",
  "registerSessionHooks",
  "registerTurnHooks",
  "documentStorage",
  "grantDirectory",
]) {
  if (!source.includes(required)) throw new Error(`SDK mirror is missing ${required}`);
}
for (const relativePath of [
  "dist/main.js",
  "dist/manifest.json",
  "dist/vendor/pixi.min.js",
  "dist/vendor/pixi.LICENSE",
  "dist/vendor/pixi-unsafe-eval.min.js",
  "dist/vendor/pixi-unsafe-eval.LICENSE",
  "dist/vendor/live2d.min.js",
  "dist/vendor/live2dcubismcore.min.js",
  "dist/vendor/live2dcubismcore.LICENSE.md",
  "dist/vendor/live2dcubismcore.RedistributableFiles.txt",
  "dist/vendor/cubism-framework.LICENSE.md",
  "dist/vendor/live2d-display.cubism2.min.js",
  "dist/vendor/pixi-live2d-display.LICENSE",
  "dist/vendor/live2d-runtime.js",
  "dist/vendor/README.md",
  "dist/icons/paw-print.svg",
]) {
  const path = resolve(root, relativePath);
  if (!statSync(path).isFile()) throw new Error(`missing package artifact: ${relativePath}`);
}
for (const relativePath of [
  "assets/vendor/live2d-display.cubism4.min.js",
  "dist/vendor/live2d-display.cubism4.min.js",
]) {
  if (existsSync(resolve(root, relativePath))) throw new Error(`obsolete runtime artifact: ${relativePath}`);
}
// `icon` is a repo-relative path. A marketplace install materializes the index
// artwork at exactly that path, but a local directory install has no such step:
// the packaged tree must carry the file there or `plugin_read_artwork` silently
// falls back to the letter tile. Keep the manifest, the repo file and both
// packaging workflows agreeing on one path.
if (typeof manifest.icon !== "string" || !manifest.icon) throw new Error("manifest.icon must be a repo-relative path");
if (!statSync(resolve(root, manifest.icon)).isFile()) throw new Error(`manifest.icon does not exist in the repo: ${manifest.icon}`);
for (const workflow of [".github/workflows/package.yml", ".github/workflows/release.yml"]) {
  const source = readFileSync(resolve(root, workflow), "utf8");
  const target = `package/ccgui-plugin-live2d-pets/${manifest.icon.replace(/\/[^/]+$/, "")}`;
  if (!source.includes(target)) throw new Error(`${workflow} does not package manifest.icon at ${target}`);
}

console.log(`validated ${manifest.id} ${manifest.version}: ${Math.round(statSync(mainPath).size / 1024)} KiB main bundle`);
