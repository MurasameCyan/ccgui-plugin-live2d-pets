import { BUILTIN_PERSONA_IDS, COPY_KEYS, type CopyTable, type CustomPersonaDef } from "./persona-shared";

export interface PersonasFileView { personas: CustomPersonaDef[]; error: string | null; path: string; }
export { PERSONAS_TEMPLATE } from "./persona-shared";

export function normalizeCustomPersona(raw: unknown): CustomPersonaDef | null {
  if (typeof raw !== "object" || raw === null) return null;
  const record = raw as Record<string, unknown>;
  const id = typeof record.id === "string" ? record.id.trim() : "";
  if (!id || !/^[a-z][a-z0-9_-]*$/i.test(id) || BUILTIN_PERSONA_IDS.includes(id as typeof BUILTIN_PERSONA_IDS[number])) return null;
  const result: CustomPersonaDef = { id };
  if (typeof record.name === "string" && record.name.trim()) result.name = record.name.trim();
  if (typeof record.base === "string" && record.base.trim()) result.base = record.base.trim();
  if (typeof record.copy === "object" && record.copy !== null) {
    const copy: Partial<CopyTable> = {};
    for (const key of COPY_KEYS) {
      const value = (record.copy as Record<string, unknown>)[key];
      if (Array.isArray(value) && value.length > 0 && value.every((line) => typeof line === "string" && line.trim())) copy[key] = value as string[];
    }
    if (Object.keys(copy).length) result.copy = copy;
  }
  return result;
}

export function parsePersonas(text: string, path = ""): PersonasFileView {
  try {
    const parsed = JSON.parse(stripJsonComments(text)) as { personas?: unknown };
    if (parsed.personas !== undefined && !Array.isArray(parsed.personas)) return { personas: [], error: 'JSONC 结构错误："personas" 必须是数组', path };
    const people: CustomPersonaDef[] = [];
    const invalid: string[] = [];
    for (const raw of Array.isArray(parsed.personas) ? parsed.personas : []) {
      const person = normalizeCustomPersona(raw);
      if (person) people.push(person);
      else invalid.push(typeof raw === "object" && raw !== null && "id" in raw && typeof raw.id === "string" ? raw.id : "?");
    }
    const seen = new Set<string>();
    const unique = people.filter((person) => !seen.has(person.id) && (seen.add(person.id), true));
    return { personas: unique, error: invalid.length ? `已跳过 ${invalid.length} 个非法条目（id：${invalid.join("、")}）` : null, path };
  } catch (error) {
    return { personas: [], error: `JSONC 解析失败：${error instanceof Error ? error.message : String(error)}`, path };
  }
}

export function stripJsonComments(text: string): string {
  let out = "";
  let inString = false;
  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i];
    const next = text[i + 1];
    if (inString) {
      out += ch;
      if (ch === "\\") out += next ?? "", i += 1;
      else if (ch === '"') inString = false;
    } else if (ch === '"') { inString = true; out += ch; }
    else if (ch === "/" && next === "/") { while (i < text.length && text[i] !== "\n") i += 1; }
    else if (ch === "/" && next === "*") { i += 2; while (i + 1 < text.length && !(text[i] === "*" && text[i + 1] === "/")) i += 1; i += 1; }
    else out += ch;
  }
  return out;
}
