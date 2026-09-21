import { readFileSync, statSync } from "node:fs";
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
if (!/^\d+\.\d+\.\d+$/.test(manifest.sdkVersion)) {
  throw new Error(`sdkVersion must be an exact x.y.z pin (no ^/~/>=/*/x), got ${JSON.stringify(manifest.sdkVersion)}`);
}
// The compat line froze at an exact SDK value; the mirror stamp and the
// pinned manifest must agree, and the mirrored PluginContext key set is
// frozen so a later host sync that drops or renames a top-level capability
// trips CI here instead of silently diverging from the contract we pin.
const sdkSource = readFileSync(resolve(root, "src/sdk.ts"), "utf8");
const sdkStamp = sdkSource.match(/@ccgui\/plugin-sdk mirror v(\d+\.\d+\.\d+)/);
if (!sdkStamp) throw new Error("src/sdk.ts is missing its `@ccgui/plugin-sdk mirror v<x.y.z>` stamp");
if (sdkStamp[1] !== manifest.sdkVersion) {
  throw new Error(`src/sdk.ts stamp v${sdkStamp[1]} != manifest.sdkVersion ${manifest.sdkVersion}`);
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
for (const pattern of [/window\.__TAURI__/i, /\beval\s*\(/i, /new\s+Function\s*\(/i, /import\s*\(\s*["'`]https?:/i]) {
  if (pattern.test(main)) throw new Error(`forbidden bundle pattern: ${pattern}`);
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
  "dist/vendor/pixi-unsafe-eval.min.js",
  "dist/vendor/pixi-unsafe-eval.LICENSE",
  "dist/vendor/live2dcubismcore.min.js",
  "dist/vendor/live2d-display.cubism4.min.js",
  "dist/icons/paw-print.svg",
]) {
  const path = resolve(root, relativePath);
  if (!statSync(path).isFile()) throw new Error(`missing package artifact: ${relativePath}`);
}

console.log(`validated ${manifest.id} ${manifest.version}: ${Math.round(statSync(mainPath).size / 1024)} KiB main bundle`);
