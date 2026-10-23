import { createElement, useEffect, useRef, useState } from "../react-runtime";
import type { ReactNode } from "../sdk";
import type { PetRuntime, PetStateView } from "../runtime";
import {
  isRemoteModelUrl,
  isSupportedModelLocation,
  type BuiltinPreset,
  type CustomModelEntry,
} from "../models";
import { PERSONAS_TEMPLATE } from "../persona-shared";
import { builtinPersonaOptions } from "./personas";

export interface PetSettingsProps { runtime: PetRuntime }

const SIZE_WRITE_DEBOUNCE_MS = 120;

const buttonStyle = {
  marginLeft: 6,
  padding: "4px 10px",
  borderRadius: 6,
  cursor: "pointer",
  background: "rgba(128,128,128,.14)",
  color: "inherit",
  border: "none",
};
const rowStyle = {
  padding: "10px 12px",
  marginBottom: 8,
  borderRadius: 8,
  background: "rgba(128,128,128,.08)",
};
const inputStyle = {
  minWidth: 90,
  padding: "5px 7px",
  borderRadius: 5,
  border: "1px solid rgba(128,128,128,.3)",
  background: "transparent",
  color: "inherit",
};
const sectionTitleStyle = { margin: "16px 0 8px", fontSize: 13, fontWeight: 600, color: "#888" };
/** Host switch, mirrored class-for-class from `components/base/switch`
 *  (`size="sm"`, `shape="pill"` — what every host settings row uses). The
 *  plugin renders inside the host document, so these utilities already exist
 *  in the compiled stylesheet; hand-rolled inline styles drifted from it.
 *  Semantics stay on a `role="switch"` button: react-aria is not reachable
 *  from a plugin bundle. */
const hostSwitchTrackClass = "relative shrink-0 transition-colors duration-200 ease h-4 w-7 rounded-full border-0 p-0";
const hostSwitchTrackOnClass = "bg-linear-to-b from-accent-500 to-accent-600 shadow-[inset_0_1px_0_0_rgb(255_255_255/0.25),inset_0_0_0_0.5px_var(--color-accent-500)]";
const hostSwitchTrackOffClass = "bg-background-tertiary-default";
const hostSwitchThumbClass = [
  "absolute flex items-center justify-center",
  "bg-linear-to-b from-control-indicator-background from-[43.837%] to-control-indicator-background-subtle",
  "shadow-[0_3px_3px_0_rgb(0_0_0/0.03),0_0.75px_0_0_rgb(0_0_0/0.05)]",
  "transition-transform duration-200 ease size-3 rounded-full left-0.5 top-0.5",
].join(" ");
const hostSwitchChipClass = "border-solid bg-linear-to-t from-[43.837%] size-[5px] border-[0.25px] shadow-[0_2px_2px_0_rgb(0_0_0/0.03)] rounded-full";

function ToggleSwitch(props: {
  checked: boolean;
  label: string;
  hint?: string;
  disabled?: boolean;
  onChange: (next: boolean) => void;
}): ReactNode {
  const { checked, label, hint, disabled, onChange } = props;
  return createElement("label",
    {
      className: `group inline-flex items-center gap-2 select-none ${disabled ? "cursor-not-allowed" : "cursor-pointer"}`,
      title: hint,
    },
    createElement("button", {
      type: "button",
      role: "switch",
      "aria-checked": checked,
      "aria-label": label,
      disabled,
      onClick: () => onChange(!checked),
      className: [
        hostSwitchTrackClass,
        checked ? hostSwitchTrackOnClass : hostSwitchTrackOffClass,
        disabled ? "opacity-50 cursor-not-allowed" : "cursor-pointer",
        "outline-none focus-visible:ring-2 focus-visible:ring-border-focus-ring focus-visible:ring-offset-2",
      ].join(" "),
    }, createElement("span", {
      "aria-hidden": true,
      className: `${hostSwitchThumbClass} ${checked ? "translate-x-3" : ""}`,
    }, createElement("span", {
      className: `${hostSwitchChipClass} ${checked ? "border-accent-600 from-switch-on-chip-start to-switch-on-chip-end" : "border-border-button-default/50 from-switch-off-chip-start to-switch-off-chip-end"}`,
    }))),
    createElement("span", { className: "text-body-medium text-text-primary" }, label),
  );
}


const hostSelectTriggerClass = [
  "flex h-8 w-auto cursor-pointer items-center justify-between gap-1 rounded-lg px-2 py-1.5",
  "border border-border-button-default bg-background-primary-default shadow-xs text-text-primary",
  "transition-[background-color,border-color,box-shadow,padding,font-size] duration-200 ease",
  "hover:bg-background-primary-hover hover:border-border-button-hover",
  "outline-none focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-border-focus-ring",
  "disabled:cursor-not-allowed disabled:bg-background-primary-disabled disabled:text-text-tertiary disabled:shadow-none",
].join(" ");
const hostSelectMenuClass = [
  "flex w-full flex-col gap-1 rounded-2xl border border-border-button-default",
  "max-h-[240px] overflow-auto bg-background-primary-default p-2 shadow-dropdown outline-none",
].join(" ");
const hostSelectOptionClass = [
  "flex w-full cursor-pointer items-center gap-2 rounded-2lg px-2 py-1.5 text-left",
  "text-text-primary outline-none transition-colors",
  "hover:bg-dropdown-item-hover-background focus-visible:bg-dropdown-item-hover-background",
].join(" ");

interface PersonaChoice { id: string; name: string }
type PersonaMenuPlacement = "top" | "bottom";
interface PersonaSelectProps {
  value: string;
  disabled: boolean;
  options: PersonaChoice[];
  onChange: (value: string) => void;
}

const PERSONA_LISTBOX_ID = "live2d-persona-listbox";

function clippingBounds(element: HTMLElement): { top: number; bottom: number } {
  let top = 0;
  let bottom = window.innerHeight;
  for (let current = element.parentElement; current; current = current.parentElement) {
    const overflowY = getComputedStyle(current).overflowY;
    if (!/(auto|scroll|hidden|clip)/.test(overflowY)) continue;
    const rect = current.getBoundingClientRect();
    top = Math.max(top, rect.top);
    bottom = Math.min(bottom, rect.bottom);
  }
  return { top, bottom };
}

function personaOptionId(id: string): string {
  return `live2d-persona-option-${encodeURIComponent(id)}`;
}

function PersonaSelect(props: PersonaSelectProps): ReactNode {
  const [open, setOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(0);
  const [placement, setPlacement] = useState<PersonaMenuPlacement>("bottom");
  const [menuMaxHeight, setMenuMaxHeight] = useState(240);
  const root = useRef<HTMLDivElement | null>(null);
  const trigger = useRef<HTMLButtonElement | null>(null);
  const optionRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const selectedIndex = Math.max(0, props.options.findIndex((option) => option.id === props.value));
  const selected = props.options[selectedIndex];

  const updatePlacement = (): void => {
    const element = trigger.current;
    if (!element) return;
    const gap = 4;
    const preferredHeight = 240;
    const rect = element.getBoundingClientRect();
    const bounds = clippingBounds(element);
    const below = Math.max(0, bounds.bottom - rect.bottom - gap);
    const above = Math.max(0, rect.top - bounds.top - gap);
    const nextPlacement: PersonaMenuPlacement = below >= preferredHeight || below >= above ? "bottom" : "top";
    const available = nextPlacement === "bottom" ? below : above;
    setPlacement(nextPlacement);
    setMenuMaxHeight(Math.max(64, Math.min(preferredHeight, Math.floor(available))));
  };
  const openMenu = (): void => {
    setActiveIndex(selectedIndex);
    updatePlacement();
    setOpen(true);
  };

  useEffect(() => {
    if (!open) return;
    const dismiss = (event: Event): void => {
      if (!root.current?.contains(event.target as Node)) setOpen(false);
    };
    const dismissOnEscape = (event: KeyboardEvent): void => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      setOpen(false);
      queueMicrotask(() => trigger.current?.focus());
    };
    const reposition = (): void => updatePlacement();
    document.addEventListener("pointerdown", dismiss, true);
    document.addEventListener("focusin", dismiss, true);
    document.addEventListener("keydown", dismissOnEscape, true);
    document.addEventListener("scroll", reposition, true);
    window.addEventListener("resize", reposition);
    return () => {
      document.removeEventListener("pointerdown", dismiss, true);
      document.removeEventListener("focusin", dismiss, true);
      document.removeEventListener("keydown", dismissOnEscape, true);
      document.removeEventListener("scroll", reposition, true);
      window.removeEventListener("resize", reposition);
    };
  }, [open]);

  useEffect(() => {
    if (!open) return;
    optionRefs.current[activeIndex]?.focus();
  }, [open, activeIndex]);

  const close = (restoreFocus = false): void => {
    setOpen(false);
    if (restoreFocus) queueMicrotask(() => trigger.current?.focus());
  };
  const focusOption = (index: number): void => {
    const count = props.options.length;
    if (count === 0) return;
    const next = (index + count) % count;
    setActiveIndex(next);
    optionRefs.current[next]?.focus();
  };
  const onTriggerKeyDown = (event: KeyboardEvent): void => {
    if (event.key === "Escape") {
      if (open) event.preventDefault();
      close();
    } else if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      if (!open) openMenu();
      else focusOption(selectedIndex + (event.key === "ArrowDown" ? 1 : -1));
    }
  };
  const onOptionKeyDown = (event: KeyboardEvent, index: number): void => {
    if (event.key === "Escape") {
      event.preventDefault();
      close(true);
    } else if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      focusOption(index + (event.key === "ArrowDown" ? 1 : -1));
    } else if (event.key === "Home" || event.key === "End") {
      event.preventDefault();
      focusOption(event.key === "Home" ? 0 : props.options.length - 1);
    } else if (event.key === "Tab") {
      close();
    }
  };
  const choose = (value: string): void => {
    props.onChange(value);
    close(true);
  };

  return createElement("div", { ref: root, style: { position: "relative", display: "inline-block" } },
    createElement("button", {
      ref: trigger,
      type: "button",
      role: "combobox",
      "aria-label": "人设台词",
      "aria-haspopup": "listbox",
      "aria-expanded": String(open),
      "aria-controls": PERSONA_LISTBOX_ID,
      "aria-activedescendant": open ? personaOptionId(props.options[activeIndex]?.id ?? props.value) : undefined,
      disabled: props.disabled,
      className: hostSelectTriggerClass,
      style: {
        minWidth: 68,
        border: "1px solid var(--color-border-button-default, rgba(128,128,128,.35))",
        borderRadius: 8,
        backgroundColor: "var(--color-background-primary-default, #1f1f1f)",
        color: "var(--color-text-primary, #f3f4f6)",
        boxShadow: "var(--shadow-xs, 0 1px 2px rgba(0,0,0,.18))",
      },
      onClick: () => { if (open) close(); else openMenu(); },
      onKeyDown: onTriggerKeyDown,
    },
    createElement("span", { style: { minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" } }, selected?.name ?? props.value),
    createElement("svg", {
      viewBox: "0 0 16 16",
      width: 14,
      height: 14,
      "aria-hidden": "true",
      style: { flexShrink: 0, transform: open ? "rotate(180deg)" : "none", transition: "transform 150ms ease" },
    }, createElement("path", { d: "M4 6l4 4 4-4", fill: "none", stroke: "currentColor", strokeWidth: 1.5, strokeLinecap: "round", strokeLinejoin: "round" }))),
    open && createElement("div", {
      id: PERSONA_LISTBOX_ID,
      role: "listbox",
      "aria-label": "人设台词",
      className: hostSelectMenuClass,
      style: {
        position: "absolute",
        zIndex: 1000,
        top: placement === "bottom" ? "calc(100% + 4px)" : undefined,
        bottom: placement === "top" ? "calc(100% + 4px)" : undefined,
        left: 0,
        width: 266,
        maxWidth: "calc(100vw - 32px)",
        maxHeight: menuMaxHeight,
        overflowY: "auto",
        border: "1px solid var(--color-border-button-default, rgba(128,128,128,.35))",
        borderRadius: 16,
        backgroundColor: "var(--color-background-primary-default, #1f1f1f)",
        color: "var(--color-text-primary, #f3f4f6)",
        boxShadow: "var(--shadow-dropdown, 0 12px 30px rgba(0,0,0,.35))",
        padding: 8,
      },
    }, props.options.map((option, index) => {
      const isSelected = option.id === props.value;
      return createElement("button", {
        key: option.id,
        ref: (element: HTMLButtonElement | null) => { optionRefs.current[index] = element; },
        type: "button",
        id: personaOptionId(option.id),
        role: "option",
        "aria-selected": String(isSelected),
        tabIndex: index === activeIndex ? 0 : -1,
        className: `${hostSelectOptionClass}${isSelected ? " bg-dropdown-item-hover-background" : ""}`,
        style: {
          width: "100%",
          border: "none",
          borderRadius: 8,
          padding: "6px 8px",
          backgroundColor: isSelected ? "var(--color-dropdown-item-hover-background, rgba(255,255,255,.08))" : undefined,
          color: "var(--color-text-primary, #f3f4f6)",
          textAlign: "left",
        },
        onFocus: () => setActiveIndex(index),
        onClick: () => choose(option.id),
        onKeyDown: (event: KeyboardEvent) => onOptionKeyDown(event, index),
      }, option.name);
    })),
  );
}


function copyText(text: string): void {
  if (!text) return;
  void navigator.clipboard?.writeText(text);
}

function modelEntry(
  id: string,
  name: string,
  modelUrl: string,
  directoryGrantId?: string,
  directoryPath?: string,
): CustomModelEntry | null {
  const trimmedName = name.trim();
  const trimmedUrl = modelUrl.trim();
  const relativePath = directoryPath ?? "";
  if (!trimmedName || !isSupportedModelLocation(trimmedUrl)) return null;
  const remote = isRemoteModelUrl(trimmedUrl);
  if (!remote && (!directoryGrantId || !relativePath)) return null;
  const entry: CustomModelEntry = { id, name: trimmedName, modelUrl: trimmedUrl };
  if (!remote && directoryGrantId && relativePath) {
    entry.directoryGrantId = directoryGrantId;
    entry.directoryPath = relativePath;
  }
  return entry;
}

function newCustomModelId(): string {
  return `m-${crypto.randomUUID()}`;
}

function modelDisplayPath(modelUrl: string, directoryGrantId?: string, directoryPath?: string): string {
  if (!directoryGrantId || !directoryPath || isRemoteModelUrl(modelUrl)) return modelUrl;
  const separator = modelUrl.includes("\\") ? "\\" : "/";
  return `${modelUrl.replace(/[\\/]+$/, "")}${separator}${directoryPath.replace(/[\\/]/g, separator)}`;
}

function ModelForm(props: {
  label: "新增模型" | "编辑模型";
  name: string;
  path: string;
  disabled: boolean;
  onNameChange: (value: string) => void;
  onBrowse: () => void;
  onSave: () => void;
  onCancel?: () => void;
}): ReactNode {
  return createElement("div", {
    role: "group",
    "aria-label": props.label,
    style: { ...rowStyle, display: "grid", gridTemplateColumns: "minmax(72px, 1fr) minmax(0, 2fr) auto", alignItems: "center", gap: 8 },
    onKeyDown: (event: KeyboardEvent) => {
      if (event.key === "Escape" && props.onCancel) {
        event.preventDefault();
        props.onCancel();
      }
    },
  },
    createElement("input", {
      style: { ...inputStyle, minWidth: 0, width: "100%", boxSizing: "border-box" },
      value: props.name,
      placeholder: "名称",
      "aria-label": "名称",
      disabled: props.disabled,
      onChange: (event: Event) => props.onNameChange((event.currentTarget as HTMLInputElement).value),
    }),
    createElement("span", {
      "aria-label": "模型路径",
      title: props.path || "未选择模型",
      style: { minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", userSelect: "text", fontSize: 12 },
    }, props.path || "未选择模型"),
    createElement("span", { style: { display: "flex", gap: 6, paddingLeft: 8, borderLeft: "1px solid rgba(128,128,128,.3)" } },
      createElement("button", { type: "button", style: { ...buttonStyle, marginLeft: 0, whiteSpace: "nowrap" }, disabled: props.disabled, onClick: props.onBrowse }, "浏览"),
      createElement("button", { type: "button", style: { ...buttonStyle, marginLeft: 0, whiteSpace: "nowrap" }, disabled: props.disabled, onClick: props.onSave }, "保存"),
    ),
  );
}

function CopyButton(props: { text: string; label: string }): ReactNode {
  return createElement("button", { type: "button", style: buttonStyle, onClick: () => copyText(props.text) }, props.label);
}

function ModelRow(props: {
  selected: boolean;
  label: string;
  disabled: boolean;
  onSelect: () => void;
  license?: BuiltinPreset["license"];
  actions?: ReactNode;
}): ReactNode {
  return createElement("div", { style: { ...rowStyle, display: "flex", alignItems: "center", gap: 8 } },
    createElement("label", { style: { display: "flex", alignItems: "center", gap: 8, flex: 1, minWidth: 0 } },
      createElement("input", { type: "radio", name: "live2d-model", checked: props.selected, disabled: props.disabled, onChange: props.onSelect }),
      createElement("span", { style: { overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" } }, props.label),
    ),
    props.license && createElement("a", { href: props.license.url, target: "_blank", rel: "noreferrer", style: { color: "inherit", fontSize: 12 } }, props.license.type),
    props.actions,
  );
}
export function PetSettingsSection(props: PetSettingsProps): ReactNode {
  const { runtime } = props;
  const initial = runtime.snapshot();
  const [view, setView] = useState<PetStateView>(initial);
  const viewRef = useRef(initial);
  const [sizeDraft, setSizeDraft] = useState(initial.config.size);
  const [notice, setNotice] = useState<string | null>(null);
  const [personaFallback, setPersonaFallback] = useState(false);
  const [newName, setNewName] = useState("");
  const [newUrl, setNewUrl] = useState("");
  const [newGrantId, setNewGrantId] = useState<string | undefined>(undefined);
  const [newDirectoryPath, setNewDirectoryPath] = useState("");
  const [editId, setEditId] = useState<string | null>(null);
  const [editName, setEditName] = useState("");
  const [editUrl, setEditUrl] = useState("");
  const [editGrantId, setEditGrantId] = useState<string | undefined>(undefined);
  const [editDirectoryPath, setEditDirectoryPath] = useState("");
  const writeQueue = useRef(Promise.resolve());
  const sizeWriteTimer = useRef<number | undefined>(undefined);
  const pendingSize = useRef<number | null>(null);
  const modelQueue = useRef(Promise.resolve());
  const modelsRef = useRef(view.customModels);
  const directoryRequests = useRef({ new: 0, edit: 0 });

  const syncView = (next: PetStateView): void => {
    viewRef.current = next;
    modelsRef.current = next.customModels;
    if (sizeWriteTimer.current === undefined && pendingSize.current === null) setSizeDraft(next.config.size);
    setView(next);
  };

  useEffect(() => {
    const unsubscribe = runtime.subscribe((next) => syncView(next));
    return () => {
      unsubscribe();
      if (sizeWriteTimer.current !== undefined) window.clearTimeout(sizeWriteTimer.current);
      sizeWriteTimer.current = undefined;
      pendingSize.current = null;
      directoryRequests.current.new += 1;
      directoryRequests.current.edit += 1;
    };
  }, [runtime]);

  const write = (path: string, value: unknown): void => {
    writeQueue.current = writeQueue.current.then(async () => {
      try {
        syncView(await runtime.setSettings([{ op: "set", path: [path], value }]));
      } catch (error) {
        setNotice(`设置保存失败：${error instanceof Error ? error.message : String(error)}`);
      }
    });
  };

  const scheduleSizeWrite = (value: number): void => {
    setSizeDraft(value);
    pendingSize.current = value;
    if (sizeWriteTimer.current !== undefined) window.clearTimeout(sizeWriteTimer.current);
    sizeWriteTimer.current = window.setTimeout(() => {
      sizeWriteTimer.current = undefined;
      const next = pendingSize.current;
      pendingSize.current = null;
      if (next !== null) write("size", next);
    }, SIZE_WRITE_DEBOUNCE_MS);
  };

  const saveModels = (compose: (current: CustomModelEntry[]) => CustomModelEntry[]): void => {
    modelQueue.current = modelQueue.current.then(async () => {
      try {
        const result = await runtime.saveCustomModels(compose(modelsRef.current));
        modelsRef.current = result.models;
        syncView(runtime.snapshot());
        if (result.error) setNotice(result.error);
      } catch (error) {
        setNotice(`模型保存失败：${error instanceof Error ? error.message : String(error)}`);
      }
    });
  };


  const pickModelFile = (target: "new" | "edit"): void => {
    const request = ++directoryRequests.current[target];
    setNotice(null);
    void runtime.grantFile().then((grant) => {
      if (directoryRequests.current[target] !== request || grant === null) return;
      const name = grant.relativePath.replace(/(?:\.model3?)?\.json$/i, "");
      if (target === "new") {
        setNewName((current) => current.trim() ? current : name);
        setNewGrantId(grant.grantId);
        setNewUrl(grant.path);
        setNewDirectoryPath(grant.relativePath);
      } else {
        setEditName((current) => current.trim() ? current : name);
        setEditGrantId(grant.grantId);
        setEditUrl(grant.path);
        setEditDirectoryPath(grant.relativePath);
      }
    }).catch((error) => {
      if (directoryRequests.current[target] !== request) return;
      setNotice(`本地模型选择失败：${error instanceof Error ? error.message : String(error)}`);
    });
  };

  const editCandidate = editId ? modelEntry(editId, editName || editId, editUrl, editGrantId, editDirectoryPath) : null;

  const modelIsAllowed = (entry: CustomModelEntry): boolean => {
    try {
      runtime.modelAssetUrl(entry);
      return true;
    } catch {
      setNotice("该远程模型域名未获插件权限；请使用 jsDelivr 或浏览选择本地模型文件。");
      return false;
    }
  };

  const addModel = (): void => {
    const candidate = modelEntry(newCustomModelId(), newName, newUrl, newGrantId, newDirectoryPath);
    if (!candidate || !modelIsAllowed(candidate)) {
      if (!candidate) setNotice("请填写名称并浏览选择模型文件。");
      return;
    }
    saveModels((current) => [...current, candidate]);
    directoryRequests.current.new += 1;
    setNewName("");
    setNewUrl("");
    setNewGrantId(undefined);
    setNewDirectoryPath("");
    setNotice(null);
  };

  const beginEdit = (entry: CustomModelEntry): void => {
    directoryRequests.current.edit += 1;
    setEditId(entry.id);
    setEditName(entry.name);
    setEditUrl(entry.modelUrl);
    setEditGrantId(entry.directoryGrantId);
    setEditDirectoryPath(entry.directoryPath ?? "");
  };

  const cancelEdit = (): void => {
    directoryRequests.current.edit += 1;
    setEditId(null);
  };

  const saveEdit = (): void => {
    if (!editId || !editCandidate || !modelIsAllowed(editCandidate)) {
      if (!editId || !editCandidate) setNotice("请填写名称并浏览选择模型文件。");
      return;
    }
    saveModels((current) => current.map((entry) => {
      if (entry.id !== editId) return entry;
      const updated: CustomModelEntry = { ...entry, ...editCandidate };
      if (!editCandidate.directoryGrantId) {
        delete updated.directoryGrantId;
        delete updated.directoryPath;
      }
      return updated;
    }));
    setNotice(null);
    cancelEdit();
  };

  const removeModel = (id: string): void => {
    saveModels((current) => current.filter((entry) => entry.id !== id));
    if (view.config.model === id) write("model", runtime.listBuiltinPresets()[0]?.id ?? "hiyori");
  };

  const openPath = (path: string, onFailure?: () => void): void => {
    void runtime.waitUntilReady().then(() => runtime.revealPath(path)).then((ok) => {
      if (!ok) {
        onFailure?.();
        setNotice(`无法用系统程序打开，请复制路径：${path}`);
      } else setNotice("已用系统默认程序打开文件");
    });
  };

  const builtin = runtime.listBuiltinPresets();
  const personas = [
    ...builtinPersonaOptions(),
    ...view.customPersonas.map((persona) => ({ id: persona.id, name: persona.name ?? persona.id })),
  ];
  const writable = true;
  const children: ReactNode[] = [];

  children.push(
    createElement("h3", { key: "title", style: { margin: "0 0 4px" } }, "桌宠配置"),
    createElement("p", { key: "sub", style: { margin: "0 0 12px", color: "#888", fontSize: 12 } }, "Live2D 桌宠由 CC GUI 插件运行时管理。"),
    createElement("div", { key: "basic", style: rowStyle },
      createElement(ToggleSwitch, {
        key: "enabled",
        checked: view.config.enabled,
        label: "显示宠物",
        disabled: !writable,
        onChange: (next: boolean) => write("enabled", next),
      }),
      createElement("div", { key: "keep-animating", style: { marginTop: 8 } },
        createElement(ToggleSwitch, {
          checked: view.config.keepAnimatingWhenInactive,
          label: "窗口非激活时保持动态",
          disabled: !writable,
          onChange: (next: boolean) => write("keepAnimatingWhenInactive", next),
        }),
      ),
      createElement("div", { style: { display: "flex", alignItems: "center", gap: 10, marginTop: 10 } },
        "尺寸",
        createElement("input", { type: "range", min: 40, max: 400, value: sizeDraft, disabled: !writable, onChange: (event: Event) => scheduleSizeWrite(Number((event.currentTarget as HTMLInputElement).value)), style: { flex: 1 } }),
        `${sizeDraft}px`,
      ),
      createElement("div", { style: { marginTop: 10 } }, "渲染帧率：", ...([30, 60, 0] as const).map((fps) => createElement("button", { key: fps, type: "button", style: { ...buttonStyle, marginLeft: 0, marginRight: 6 }, onClick: () => write("maxFps", fps) }, view.config.maxFps === fps ? `✓ ${fps || "不限制"}` : String(fps || "不限制")))),
    ),
  );

  children.push(
    createElement("div", { key: "persona" },
      createElement("div", { style: sectionTitleStyle }, "人设台词"),
      createElement("div", { style: rowStyle },
        createElement("div", { style: { display: "flex", gap: 8, alignItems: "center" } },
          createElement(PersonaSelect, { value: view.config.persona, disabled: !writable, options: personas, onChange: (value: string) => write("persona", value) }),
          createElement("button", { style: buttonStyle, onClick: () => { void runtime.reloadPersonas().then((result) => setNotice(result.error ?? "已重新读取人设文件")); } }, "↻ 重新读取"),
          createElement("button", { style: buttonStyle, onClick: () => { setPersonaFallback(false); openPath(view.personasFile, () => setPersonaFallback(true)); } }, "打开文件"),
        ),
        createElement("div", { style: { marginTop: 6, fontSize: 12, color: view.personasError ? "#b45309" : "#888", wordBreak: "break-all" } }, view.personasError ?? view.personasFile),
        personaFallback && createElement("div", { style: { marginTop: 8, padding: 8, background: "rgba(128,128,128,.12)", fontSize: 12 } },
          "无法直接打开，请复制路径或模板：",
          createElement("div", { style: { margin: "4px 0", wordBreak: "break-all" } }, view.personasFile),
          CopyButton({ text: view.personasFile, label: "复制路径" }),
          CopyButton({ text: PERSONAS_TEMPLATE, label: "复制人设模板" }),
        ),
      ),
    ),
  );

  const builtinRows = builtin.map((preset) => createElement(ModelRow, {
    key: preset.id,
    selected: view.config.model === preset.id,
    label: `${preset.name}（${preset.author}）`,
    disabled: !writable,
    onSelect: () => write("model", preset.id),
    license: preset.license,
  }));
  const customRows = view.customModels.map((entry) => {
    if (editId === entry.id) {
      return createElement(ModelForm, {
        key: entry.id,
        label: "编辑模型",
        name: editName,
        path: modelDisplayPath(editUrl, editGrantId, editDirectoryPath),
        disabled: !writable,
        onNameChange: setEditName,
        onBrowse: () => pickModelFile("edit"),
        onSave: saveEdit,
        onCancel: cancelEdit,
      });
    }
    return createElement(ModelRow, {
      key: entry.id,
      selected: view.config.model === entry.id,
      label: entry.name,
      disabled: !writable,
      onSelect: () => write("model", entry.id),
      actions: createElement("span", null,
        createElement("button", { style: buttonStyle, onClick: () => beginEdit(entry) }, "修改"),
        createElement("button", { style: buttonStyle, onClick: () => removeModel(entry.id) }, "删除"),
      ),
    });
  });

  children.push(
    createElement("div", { key: "models" },
      createElement("div", { style: sectionTitleStyle }, "内置模型（只读）"),
      createElement("div", { role: "radiogroup", "aria-label": "内置模型" }, builtinRows),
      createElement("div", { style: { ...sectionTitleStyle, display: "flex", justifyContent: "space-between" } },
        "我的模型",
        createElement("button", { style: { ...buttonStyle, marginLeft: 0 }, onClick: () => openPath(view.customModelsFile) }, "打开配置文件"),
      ),
      view.customModelsError && createElement("div", { style: { color: "#b45309", fontSize: 12, marginBottom: 6 } }, view.customModelsError),
      createElement("div", { role: "radiogroup", "aria-label": "我的模型" }, customRows.length ? customRows : createElement("div", { style: { ...rowStyle, color: "#888", fontSize: 12 } }, "尚未添加自定义模型")),
      createElement(ModelForm, {
        label: "新增模型",
        name: newName,
        path: modelDisplayPath(newUrl, newGrantId, newDirectoryPath),
        disabled: !writable,
        onNameChange: setNewName,
        onBrowse: () => pickModelFile("new"),
        onSave: addModel,
      }),
    ),
  );

  children.push(
    createElement("div", { key: "developer" },
      createElement("div", { style: sectionTitleStyle }, "开发者选项"),
      createElement("div", { style: rowStyle },
        createElement(ToggleSwitch, {
          checked: view.config.developerMode,
          label: "启用开发者选项",
          disabled: !writable,
          onChange: (next: boolean) => write("developerMode", next),
        }),
        view.config.developerMode && createElement("div", { style: { marginTop: 8, display: "flex", flexDirection: "column", gap: 8 } },
          createElement(ToggleSwitch, {
            key: "debug",
            checked: view.config.debug,
            label: "调试面板",
            disabled: !writable,
            onChange: (next: boolean) => write("debug", next),
          }),
          createElement(ToggleSwitch, {
            key: "tap-zones",
            checked: view.config.showTapZones,
            label: "显示点击分区（空间回退色块）",
            disabled: !writable,
            onChange: (next: boolean) => write("showTapZones", next),
          }),
        ),
      ),
    ),
    notice && createElement("div", { key: "notice", style: { color: "#b45309", fontSize: 12, wordBreak: "break-word" } }, notice),
  );

  return createElement("div", { style: { padding: "16px 20px", maxWidth: 680 } }, ...children);
}
