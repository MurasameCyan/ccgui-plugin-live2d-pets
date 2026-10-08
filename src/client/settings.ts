import { createElement, useEffect, useRef, useState } from "../react-runtime";
import type { ReactNode } from "../sdk";
import type { PetRuntime, PetStateView } from "../runtime";
import {
  ANIMATION_SLOTS,
  isRemoteModelUrl,
  isSupportedModelLocation,
  type AnimationSlot,
  type BuiltinPreset,
  type CustomModelEntry,
  type MotionMap,
} from "../models";
import { PERSONAS_TEMPLATE } from "../persona-shared";
import { builtinPersonaOptions } from "./personas";
import {
  EMPTY_SPATIAL_DRAFT,
  SPATIAL_FIELD_LABELS,
  draftFromMotionMap,
  draftFromOverride,
  motionMapFromDraft,
  overrideFromDraft,
  type SpatialTapDraft,
} from "../settings-helpers";

export interface PetSettingsProps { runtime: PetRuntime }

type DraftSetter = (value: MotionMap | ((current: MotionMap) => MotionMap)) => void;
type SpatialSetter = (value: SpatialTapDraft | ((current: SpatialTapDraft) => SpatialTapDraft)) => void;
type EditorPanel = "spatial" | "motion" | null;
type MotionStatus = "idle" | "loading" | "ready" | "error";
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
const panelTabStyle = { ...buttonStyle, marginLeft: 0, padding: "4px 12px" };
const panelTabActiveStyle = { ...panelTabStyle, background: "rgba(120,170,255,.26)", color: "#fff" };
/** 按钮式开关：轨道 + 滑块，语义用 role="switch"（替代原生 checkbox）。 */
const switchTrackStyle = {
  position: "relative" as const,
  flex: "0 0 auto",
  width: 34,
  height: 18,
  padding: 0,
  borderRadius: 999,
  border: "none",
  cursor: "pointer",
  transition: "background .15s",
};
const switchKnobStyle = {
  position: "absolute" as const,
  top: 2,
  width: 14,
  height: 14,
  borderRadius: "50%",
  background: "#fff",
  transition: "left .15s",
};

function ToggleSwitch(props: {
  checked: boolean;
  label: string;
  hint?: string;
  disabled?: boolean;
  onChange: (next: boolean) => void;
}): ReactNode {
  const { checked, label, hint, disabled, onChange } = props;
  return createElement("div",
    { style: { display: "flex", alignItems: "center", gap: 8 }, title: hint },
    createElement("button", {
      type: "button",
      role: "switch",
      "aria-checked": checked,
      "aria-label": label,
      disabled,
      onClick: () => onChange(!checked),
      style: {
        ...switchTrackStyle,
        background: checked ? "rgba(120,170,255,.75)" : "rgba(128,128,128,.32)",
        opacity: disabled ? 0.5 : 1,
        cursor: disabled ? "not-allowed" : "pointer",
      },
    }, createElement("span", { style: { ...switchKnobStyle, left: checked ? 18 : 2 } })),
    createElement("span", { style: { fontSize: 13 } }, label),
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

const ANIMATION_SLOT_LABELS: Record<AnimationSlot, string> = {
  idle: "空闲",
  thinking: "思考",
  error: "出错",
  done: "完成",
  waiting: "等待审批",
  head: "摸头",
  leg: "摸腿",
  arm: "摸手",
  body: "摸身体",
};

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
  const trimmedDirectoryPath = directoryPath?.trim() ?? "";
  if (!trimmedName || !isSupportedModelLocation(trimmedUrl)) return null;
  const remote = isRemoteModelUrl(trimmedUrl);
  if (!remote && (!directoryGrantId || !trimmedDirectoryPath)) return null;
  const entry: CustomModelEntry = { id, name: trimmedName, modelUrl: trimmedUrl };
  if (!remote && directoryGrantId && trimmedDirectoryPath) {
    entry.directoryGrantId = directoryGrantId;
    entry.directoryPath = trimmedDirectoryPath;
  }
  return entry;
}

function newCustomModelId(): string {
  return `m-${crypto.randomUUID()}`;
}

function motionMapFields(
  draft: MotionMap,
  setDraft: DraftSetter,
  groups: readonly string[],
  status: MotionStatus,
  disabled: boolean,
): ReactNode {
  const toggle = (slot: AnimationSlot, group: string, checked: boolean) => {
    setDraft((current) => {
      const next = { ...current };
      const selected = new Set(next[slot] ?? []);
      if (checked) selected.add(group); else selected.delete(group);
      next[slot] = [...selected];
      return next;
    });
  };
  return createElement("div", null,
    status === "loading" && createElement("div", { style: { color: "#888", fontSize: 12 } }, "正在解析动作组…"),
    status === "error" && createElement("div", { style: { color: "#b45309", fontSize: 12 } }, "无法解析动画列表；模型仍可保存，稍后可重试。"),
    status === "ready" && groups.length === 0 && createElement("div", { style: { color: "#888", fontSize: 12 } }, "模型没有可识别的动作组。"),
    status === "ready" && groups.length > 0 && ANIMATION_SLOTS.map((slot) => createElement("div", { key: slot, style: { marginTop: 8 } },
      createElement("div", { style: { fontSize: 12, marginBottom: 3 } }, ANIMATION_SLOT_LABELS[slot]),
      createElement("div", { style: { display: "flex", flexWrap: "wrap", gap: 6 } }, groups.map((group) => createElement("label", { key: `${slot}:${group}`, style: { fontSize: 12 } },
        createElement("input", {
          type: "checkbox",
          checked: (draft[slot] ?? []).includes(group),
          disabled,
          onChange: (event: Event) => toggle(slot, group, (event.currentTarget as HTMLInputElement).checked),
        }),
        ` ${group}`,
      ))),
    )),
  );
}

function spatialFields(draft: SpatialTapDraft, setDraft: SpatialSetter, disabled: boolean): ReactNode {
  return createElement("div", { style: { display: "grid", gridTemplateColumns: "repeat(3, minmax(0, 1fr))", gap: 6 } },
    SPATIAL_FIELD_LABELS.map(({ key, label, hint }) => createElement("label", { key, style: { display: "flex", flexDirection: "column", gap: 3, fontSize: 11 } },
      `${label} (${hint})`,
      createElement("input", {
        ...inputStyle,
        type: "number",
        min: 0,
        max: 1,
        step: 0.01,
        placeholder: "默认",
        value: draft[key],
        disabled,
        onChange: (event: Event) => setDraft((current) => ({ ...current, [key]: (event.currentTarget as HTMLInputElement).value })),
      }),
    )),
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
  const [newGrantPath, setNewGrantPath] = useState("");
  const [newDirectoryPath, setNewDirectoryPath] = useState("");
  const [newSpatial, setNewSpatial] = useState<SpatialTapDraft>({ ...EMPTY_SPATIAL_DRAFT });
  const [newMotion, setNewMotion] = useState<MotionMap>({});
  const [newGroups, setNewGroups] = useState<string[]>([]);
  const [newMotionStatus, setNewMotionStatus] = useState<MotionStatus>("idle");
  const [newPanel, setNewPanel] = useState<EditorPanel>(null);
  const [editId, setEditId] = useState<string | null>(null);
  const [editName, setEditName] = useState("");
  const [editUrl, setEditUrl] = useState("");
  const [editGrantId, setEditGrantId] = useState<string | undefined>(undefined);
  const [editGrantPath, setEditGrantPath] = useState("");
  const [editDirectoryPath, setEditDirectoryPath] = useState("");
  const [editSpatial, setEditSpatial] = useState<SpatialTapDraft>({ ...EMPTY_SPATIAL_DRAFT });
  const [editMotion, setEditMotion] = useState<MotionMap>({});
  const [editGroups, setEditGroups] = useState<string[]>([]);
  const [editMotionStatus, setEditMotionStatus] = useState<MotionStatus>("idle");
  const [editPanel, setEditPanel] = useState<EditorPanel>(null);
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

  const changeModelUrl = (target: "new" | "edit", value: string): void => {
    // A manually edited address is a new source, not an alias for the old grant.
    directoryRequests.current[target] += 1;
    if (target === "new") {
      setNewUrl(value);
      setNewGrantId(undefined);
      setNewGrantPath("");
      setNewDirectoryPath("");
    } else {
      setEditUrl(value);
      setEditGrantId(undefined);
      setEditGrantPath("");
      setEditDirectoryPath("");
    }
    setNotice(null);
  };

  const pickDirectory = (target: "new" | "edit"): void => {
    const request = ++directoryRequests.current[target];
    void runtime.grantDirectory().then((grant) => {
      if (directoryRequests.current[target] !== request) return;
      if (target === "new") {
        setNewGrantId(grant.grantId);
        setNewGrantPath(grant.path);
        setNewUrl(grant.path);
      } else {
        setEditGrantId(grant.grantId);
        setEditGrantPath(grant.path);
        setEditUrl(grant.path);
      }
      setNotice("目录已授权；请填写目录内的 .model.json 或 .model3.json 相对路径。");
    }).catch((error) => {
      if (directoryRequests.current[target] !== request) return;
      setNotice(`目录授权失败：${error instanceof Error ? error.message : String(error)}`);
    });
  };

  const newCandidate = modelEntry("preview", newName || "preview", newUrl, newGrantId, newDirectoryPath);
  const editCandidate = editId ? modelEntry(editId, editName || editId, editUrl, editGrantId, editDirectoryPath) : null;

  useEffect(() => {
    if (newPanel !== "motion" || !newCandidate) {
      setNewMotionStatus("idle");
      setNewGroups([]);
      return;
    }
    let alive = true;
    setNewMotionStatus("loading");
    void runtime.fetchMotionGroups(newCandidate).then((groups) => {
      if (!alive) return;
      setNewGroups(groups);
      setNewMotionStatus("ready");
    }).catch(() => {
      if (!alive) return;
      setNewGroups([]);
      setNewMotionStatus("error");
    });
    return () => { alive = false; };
  }, [newPanel, newUrl, newGrantId, newDirectoryPath, runtime]);

  useEffect(() => {
    if (editPanel !== "motion" || !editCandidate) {
      setEditMotionStatus("idle");
      setEditGroups([]);
      return;
    }
    let alive = true;
    setEditMotionStatus("loading");
    void runtime.fetchMotionGroups(editCandidate).then((groups) => {
      if (!alive) return;
      setEditGroups(groups);
      setEditMotionStatus("ready");
    }).catch(() => {
      if (!alive) return;
      setEditGroups([]);
      setEditMotionStatus("error");
    });
    return () => { alive = false; };
  }, [editPanel, editUrl, editGrantId, editDirectoryPath, runtime]);
  const modelIsAllowed = (entry: CustomModelEntry): boolean => {
    try {
      runtime.modelAssetUrl(entry);
      return true;
    } catch {
      setNotice("该远程模型域名未获插件权限；请使用 jsDelivr 或选择本地授权目录。");
      return false;
    }
  };

  const addModel = (): void => {
    const candidate = modelEntry(newCustomModelId(), newName, newUrl, newGrantId, newDirectoryPath);
    if (!candidate || !modelIsAllowed(candidate)) {
      if (!candidate) setNotice("请填写名称与可访问的模型地址；本地模型需先授权目录并填写相对路径。");
      return;
    }
    const spatialTap = overrideFromDraft(newSpatial);
    const animationMap = motionMapFromDraft(newMotion);
    if (spatialTap) candidate.spatialTap = spatialTap;
    if (animationMap) candidate.animationMap = animationMap;
    saveModels((current) => [...current, candidate]);
    setNewName(""); changeModelUrl("new", "");
    setNewSpatial({ ...EMPTY_SPATIAL_DRAFT }); setNewMotion({}); setNewPanel(null);
  };

  const beginEdit = (entry: CustomModelEntry): void => {
    directoryRequests.current.edit += 1;
    setEditId(entry.id);
    setEditName(entry.name);
    setEditUrl(entry.modelUrl);
    setEditGrantId(entry.directoryGrantId);
    setEditGrantPath(entry.directoryGrantId ? entry.modelUrl : "");
    setEditDirectoryPath(entry.directoryPath ?? "");
    setEditSpatial(draftFromOverride(entry.spatialTap));
    setEditMotion(draftFromMotionMap(entry.animationMap));
    setEditPanel(null);
    setEditMotionStatus("idle");
  };

  const cancelEdit = (): void => {
    directoryRequests.current.edit += 1;
    setEditId(null);
    setEditPanel(null);
  };

  const saveEdit = (): void => {
    if (!editId || !editCandidate || !modelIsAllowed(editCandidate)) {
      if (!editId || !editCandidate) setNotice("请填写名称与可访问的模型地址。");
      return;
    }
    const spatialTap = overrideFromDraft(editSpatial);
    const animationMap = motionMapFromDraft(editMotion);
    const updated: CustomModelEntry = { ...editCandidate };
    if (spatialTap) updated.spatialTap = spatialTap;
    if (animationMap) updated.animationMap = animationMap;
    saveModels((current) => current.map((entry) => entry.id === editId ? updated : entry));
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
      return createElement("div", { key: entry.id, style: { ...rowStyle, display: "flex", flexDirection: "column", gap: 6 } },
        createElement("div", { style: { display: "flex", gap: 6, flexWrap: "wrap" } },
          createElement("input", { style: inputStyle, value: editName, placeholder: "名称", onChange: (event: Event) => setEditName((event.currentTarget as HTMLInputElement).value) }),
          createElement("input", { style: { ...inputStyle, flex: 1 }, value: editUrl, placeholder: "https://…/model.json 或 model3.json，或已授权目录", onChange: (event: Event) => changeModelUrl("edit", (event.currentTarget as HTMLInputElement).value) }),
          createElement("button", { style: buttonStyle, onClick: saveEdit }, "保存"),
          createElement("button", { style: buttonStyle, onClick: cancelEdit }, "取消"),
        ),
        createElement("div", { style: { display: "flex", gap: 6, flexWrap: "wrap" } },
          createElement("button", { style: panelTabStyle, onClick: () => pickDirectory("edit") }, "重新授权目录"),
          editGrantPath && createElement("span", { style: { fontSize: 11, color: "#888", alignSelf: "center", wordBreak: "break-all" } }, editGrantPath),
          editGrantId && createElement("input", { style: { ...inputStyle, flex: 1 }, value: editDirectoryPath, placeholder: "目录内相对 .model.json 或 .model3.json 路径", onChange: (event: Event) => setEditDirectoryPath((event.currentTarget as HTMLInputElement).value) }),
        ),
        createElement("div", { style: { display: "flex", gap: 4 } },
          createElement("button", { style: editPanel === "spatial" ? panelTabActiveStyle : panelTabStyle, onClick: () => setEditPanel(editPanel === "spatial" ? null : "spatial") }, "空间分区覆盖"),
          createElement("button", { style: editPanel === "motion" ? panelTabActiveStyle : panelTabStyle, onClick: () => setEditPanel(editPanel === "motion" ? null : "motion") }, "动画映射"),
        ),
        editPanel === "spatial" && spatialFields(editSpatial, setEditSpatial, !writable),
        editPanel === "motion" && motionMapFields(editMotion, setEditMotion, editGroups, editMotionStatus, !writable),
      );
    }
    const flags = [entry.spatialTap && "分区已覆盖", entry.animationMap && "动画已映射"].filter(Boolean).join(" · ");
    return createElement(ModelRow, {
      key: entry.id,
      selected: view.config.model === entry.id,
      label: `${entry.name}${flags ? ` · ${flags}` : ""}`,
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
      createElement("div", { style: { ...rowStyle, display: "flex", flexDirection: "column", gap: 6 } },
        createElement("div", { style: { display: "flex", gap: 6, flexWrap: "wrap" } },
          createElement("input", { style: inputStyle, value: newName, placeholder: "名称", disabled: !writable, onChange: (event: Event) => setNewName((event.currentTarget as HTMLInputElement).value) }),
          createElement("input", { style: { ...inputStyle, flex: 1 }, value: newUrl, placeholder: "https://…/model.json 或 model3.json，或已授权目录", disabled: !writable, onChange: (event: Event) => changeModelUrl("new", (event.currentTarget as HTMLInputElement).value) }),
          createElement("button", { style: buttonStyle, disabled: !writable, onClick: addModel }, "添加"),
        ),
        createElement("div", { style: { display: "flex", gap: 6, flexWrap: "wrap" } },
          createElement("button", { style: panelTabStyle, disabled: !writable, onClick: () => pickDirectory("new") }, "选择本地模型目录"),
          newGrantPath && createElement("span", { style: { fontSize: 11, color: "#888", alignSelf: "center", wordBreak: "break-all" } }, newGrantPath),
          newGrantId && createElement("input", { style: { ...inputStyle, flex: 1 }, value: newDirectoryPath, placeholder: "目录内相对 .model.json 或 .model3.json 路径", disabled: !writable, onChange: (event: Event) => setNewDirectoryPath((event.currentTarget as HTMLInputElement).value) }),
        ),
        createElement("div", { style: { display: "flex", gap: 4 } },
          createElement("button", { style: newPanel === "spatial" ? panelTabActiveStyle : panelTabStyle, disabled: !writable, onClick: () => setNewPanel(newPanel === "spatial" ? null : "spatial") }, "空间分区覆盖"),
          createElement("button", { style: newPanel === "motion" ? panelTabActiveStyle : panelTabStyle, disabled: !writable, onClick: () => setNewPanel(newPanel === "motion" ? null : "motion") }, "动画映射"),
        ),
        newPanel === "spatial" && spatialFields(newSpatial, setNewSpatial, !writable),
        newPanel === "motion" && motionMapFields(newMotion, setNewMotion, newGroups, newMotionStatus, !writable),
      ),
    ),
  );

  children.push(
    createElement("div", { key: "developer" },
      createElement("div", { style: sectionTitleStyle }, "开发者选项"),
      createElement("div", { style: rowStyle },
        createElement("label", null, createElement("input", { type: "checkbox", checked: view.config.developerMode, disabled: !writable, onChange: (event: Event) => write("developerMode", (event.currentTarget as HTMLInputElement).checked) }), " 启用开发者选项"),
        view.config.developerMode && createElement("div", { style: { marginTop: 8 } },
          createElement("label", { style: { display: "block" } }, createElement("input", { type: "checkbox", checked: view.config.debug, disabled: !writable, onChange: (event: Event) => write("debug", (event.currentTarget as HTMLInputElement).checked) }), " 调试面板"),
          createElement("label", { style: { display: "block", marginTop: 8 } }, createElement("input", { type: "checkbox", checked: view.config.showTapZones, disabled: !writable, onChange: (event: Event) => write("showTapZones", (event.currentTarget as HTMLInputElement).checked) }), " 显示点击分区（空间回退色块）"),
        ),
      ),
    ),
    notice && createElement("div", { key: "notice", style: { color: "#b45309", fontSize: 12, wordBreak: "break-word" } }, notice),
  );

  return createElement("div", { style: { padding: "16px 20px", maxWidth: 680 } }, ...children);
}
