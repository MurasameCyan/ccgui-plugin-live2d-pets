import type { Disposer, PluginContext } from "./sdk";
import { PetRuntime } from "./runtime";
import { createPetOverlay } from "./client/index";
import { PetSettingsSection } from "./client/settings";
import { clearReactRuntime, setReactRuntime } from "./react-runtime";
import { PawPrintIcon } from "./client/paw-icon";

export default function activate(ctx: PluginContext): Disposer {
  setReactRuntime(ctx.react);
  const runtime = new PetRuntime(ctx);
  ctx.ui.registerOverlay({ key: "pet", component: createPetOverlay(runtime), order: 100 });
  ctx.ui.registerSettingsSection({
    key: "settings",
    label: () => "Live2D 桌宠",
    icon: (props) => ctx.react.createElement(PawPrintIcon, props),
    component: () => ctx.react.createElement(PetSettingsSection, { runtime }),
  });
  ctx.ui.registerCommand({
    key: "reset-position",
    title: () => "重置桌宠位置",
    keywords: () => ["Live2D", "宠物", "位置"],
    run: () => { void runtime.resetDisplay(); },
  });
  return () => {
    runtime.dispose();
    clearReactRuntime();
  };
}

export { PetRuntime } from "./runtime";
export type { PetConfig, PetState, PetStateView } from "./runtime";
export * from "./models";
