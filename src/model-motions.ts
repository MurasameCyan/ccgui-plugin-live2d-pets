export type MotionDefinitionItem = Record<string, unknown> | null;
export type MotionDefinitions = Record<string, MotionDefinitionItem[]>;

export interface MotionPlaybackScript {
  loop: boolean;
  lyrics?: { duration: number; cues: Array<{ time: number; text: string }> };
}

function recordOf(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

/** Optional per-motion model3 metadata; ordinary motions retain their native lifecycle. */
export function motionPlaybackScript(definition: unknown): MotionPlaybackScript | null {
  const extension = recordOf(recordOf(definition).CCGUI);
  const loop = extension.Loop === true;
  const lyrics = recordOf(extension.Lyrics);
  const duration = lyrics.Duration;
  const cues: Array<{ time: number; text: string }> = [];
  if (typeof duration === "number" && Number.isFinite(duration) && duration > 0 && Array.isArray(lyrics.Cues)) {
    for (const raw of lyrics.Cues) {
      const cue = recordOf(raw);
      if (typeof cue.Time !== "number" || !Number.isFinite(cue.Time) || cue.Time < 0 || cue.Time >= duration
        || typeof cue.Text !== "string" || !cue.Text.trim()
        || (cues.length === 0 ? cue.Time !== 0 : cue.Time <= cues[cues.length - 1]!.time)) {
        return loop ? { loop } : null;
      }
      cues.push({ time: cue.Time, text: cue.Text });
    }
    if (cues.length > 0) return { loop, lyrics: { duration, cues } };
  }
  return loop ? { loop } : null;
}

/**
 * Extracts native motion groups without normalizing their names. Modern
 * model3.json uses FileReferences.Motions/File; the older model.json shape
 * uses lowercase motions/file. A modern references block wins when both
 * shapes are present.
 */
export function modelMotionDefinitions(data: unknown): MotionDefinitions {
  const root = recordOf(data);
  const references = recordOf(root.FileReferences);
  const candidate = Object.prototype.hasOwnProperty.call(references, "Motions")
    ? references.Motions
    : Object.prototype.hasOwnProperty.call(root, "Motions")
      ? root.Motions
      : root.motions;
  const groups = recordOf(candidate);
  const result: MotionDefinitions = {};
  for (const [group, entries] of Object.entries(groups)) {
    if (!Array.isArray(entries)) continue;
    result[group] = entries.map((entry) => {
      if (typeof entry === "object" && entry !== null && !Array.isArray(entry)) {
        return entry as MotionDefinitionItem;
      }
      return entry === null ? null : {};
    });
  }
  return result;
}

function motionFile(item: MotionDefinitionItem, index: number): string {
  if (item) {
    const modern = item.File;
    if (typeof modern === "string" && modern.length > 0) return modern;
    const legacy = item.file;
    if (typeof legacy === "string" && legacy.length > 0) return legacy;
  }
  return String(index);
}

export function modelMotionList(definitions: MotionDefinitions): Array<{ group: string; index: number; label: string }> {
  const result: Array<{ group: string; index: number; label: string }> = [];
  for (const [group, entries] of Object.entries(definitions)) {
    entries.forEach((entry, index) => {
      result.push({ group, index, label: `${group} / ${motionFile(entry, index)}` });
    });
  }
  return result;
}

/** 将逻辑候选映射到模型实际动作组名，兼容大小写、空格、短横线和下划线差异。 */
export function resolveMotionNames(
  candidates: readonly string[],
  nativeGroups: readonly string[],
): string[] {
  const normalize = (value: string): string => value.replace(/[_\s-]/g, "").toLowerCase();
  const result: string[] = [];
  const seen = new Set<string>();
  for (const candidate of candidates) {
    const native = nativeGroups.find((group) => normalize(group) === normalize(candidate));
    const resolved = native ?? candidate;
    if (!seen.has(resolved)) {
      seen.add(resolved);
      result.push(resolved);
    }
  }
  return result;
}
