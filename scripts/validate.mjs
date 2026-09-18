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
  "assets:bundle",
  "assets:directory",
  "network:cdn.jsdelivr.net",
];

if (!/^[a-z0-9][a-z0-9-]*(?:\.[a-z0-9][a-z0-9-]*)*$/.test(manifest.id)) throw new Error(`invalid plugin id: ${manifest.id}`);
if (!/^\d+\.\d+\.\d+$/.test(manifest.version)) throw new Error(`invalid plugin version: ${manifest.version}`);
if (manifest.sdkVersion !== "^0.4.3") throw new Error(`unsupported sdkVersion: ${manifest.sdkVersion}`);
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
  "dist/vendor/live2dcubismcore.min.js",
  "dist/vendor/live2d-display.cubism4.min.js",
  "dist/icons/paw-print.svg",
]) {
  const path = resolve(root, relativePath);
  if (!statSync(path).isFile()) throw new Error(`missing package artifact: ${relativePath}`);
}

console.log(`validated ${manifest.id} ${manifest.version}: ${Math.round(statSync(mainPath).size / 1024)} KiB main bundle`);
