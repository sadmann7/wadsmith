// A change to a map as the entities it sets or removes, so two people's edits
// to different things combine, and the later of two edits to one thing wins.
// It works on a map as plain JSON, so the editor and the rooms server share it.

type Json = Record<string, unknown>;

// Collections kept by key, and collections kept as lists of items with ids.
const keyed = ["vertices", "lines"] as const;
const listed = ["sectors", "things", "switches", "notes"] as const;
// Fields of the map itself that edits change. Its name changes through its
// settings and travels with the whole map.
const fields = ["complevel"] as const;

type Collection = (typeof keyed)[number] | (typeof listed)[number];

// Each entity's new value, or null when it was removed.
export interface MapPatch {
  set?: Partial<Record<Collection, Record<string, unknown>>>;
  fields?: Partial<Record<(typeof fields)[number], unknown>>;
}

// What turns one map into the other.
export function diffMaps(from: object, to: object): MapPatch {
  const before = from as Json;
  const after = to as Json;
  const set: MapPatch["set"] = {};
  for (const name of [...keyed, ...listed]) {
    const was = entries(before, name);
    const now = entries(after, name);
    const changed: Record<string, unknown> = {};
    for (const [key, value] of now) {
      const old = was.get(key);
      if (old !== value && !getIsSame(old, value)) changed[key] = value;
    }
    for (const key of was.keys()) {
      if (!now.has(key)) changed[key] = null;
    }
    if (Object.keys(changed).length > 0) set[name] = changed;
  }
  const changedFields: MapPatch["fields"] = {};
  for (const name of fields) {
    if (!getIsSame(before[name], after[name])) {
      changedFields[name] = after[name] ?? null;
    }
  }
  return {
    ...(Object.keys(set).length > 0 && { set }),
    ...(Object.keys(changedFields).length > 0 && { fields: changedFields }),
  };
}

// The map with the patch's entities set. A new item joins the end of its list.
export function applyPatch<T extends object>(source: T, patch: MapPatch): T {
  const map = source as Json;
  const next: Json = { ...map };
  for (const [name, changes] of Object.entries(patch.set ?? {})) {
    if (!changes) continue;
    if ((keyed as readonly string[]).includes(name)) {
      const record = { ...(map[name] as Json | undefined) };
      for (const [key, value] of Object.entries(changes)) {
        if (value === null) delete record[key];
        else record[key] = value;
      }
      if (name === "lines" && Object.keys(record).length === 0) {
        delete next[name];
      } else next[name] = record;
    } else if ((listed as readonly string[]).includes(name)) {
      const list = [...((map[name] as Json[] | undefined) ?? [])];
      for (const [key, value] of Object.entries(changes)) {
        const at = list.findIndex((item) => item.id === key);
        if (value === null) {
          if (at >= 0) list.splice(at, 1);
        } else if (at >= 0) list[at] = value as Json;
        else list.push(value as Json);
      }
      if (name === "notes" && list.length === 0) delete next[name];
      else next[name] = list;
    }
  }
  for (const [name, value] of Object.entries(patch.fields ?? {})) {
    if (!(fields as readonly string[]).includes(name)) continue;
    if (value === null) delete next[name];
    else next[name] = value;
  }
  return next as T;
}

// Every entity a patch touches, as "collection:key" or "field:name".
export function patchKeys(patch: MapPatch) {
  return [
    ...Object.entries(patch.set ?? {}).flatMap(([name, changes]) =>
      Object.keys(changes ?? {}).map((key) => `${name}:${key}`),
    ),
    ...Object.keys(patch.fields ?? {}).map((name) => `field:${name}`),
  ];
}

// The patch without the entities named, as when they hold edits of one's own
// that the server orders after it.
export function withoutKeys(patch: MapPatch, skip: ReadonlySet<string>) {
  const set: MapPatch["set"] = {};
  for (const [name, changes] of Object.entries(patch.set ?? {})) {
    const kept = Object.fromEntries(
      Object.entries(changes ?? {}).filter(
        ([key]) => !skip.has(`${name}:${key}`),
      ),
    );
    if (Object.keys(kept).length > 0) set[name as Collection] = kept;
  }
  const kept = Object.fromEntries(
    Object.entries(patch.fields ?? {}).filter(
      ([name]) => !skip.has(`field:${name}`),
    ),
  );
  return {
    ...(Object.keys(set).length > 0 && { set }),
    ...(Object.keys(kept).length > 0 && { fields: kept }),
  };
}

export function getIsEmptyPatch(patch: MapPatch) {
  return !patch.set && !patch.fields;
}

// A patch as the server takes it: only known collections and fields, entities
// as objects or null, and list items whose id matches their key.
export function parsePatch(value: unknown): MapPatch | null {
  if (!getIsRecord(value)) return null;
  const { set = {}, fields: changed = {} } = value;
  if (!getIsRecord(set) || !getIsRecord(changed)) return null;
  for (const [name, changes] of Object.entries(set)) {
    const isListed = (listed as readonly string[]).includes(name);
    if (!isListed && !(keyed as readonly string[]).includes(name)) return null;
    if (!getIsRecord(changes)) return null;
    for (const [key, entity] of Object.entries(changes)) {
      if (key === "__proto__" || key.length > 200) return null;
      if (entity === null) continue;
      if (!getIsRecord(entity)) return null;
      if (isListed && entity.id !== key) return null;
    }
  }
  for (const name of Object.keys(changed)) {
    if (!(fields as readonly string[]).includes(name)) return null;
  }
  return value;
}

function entries(map: Json, name: Collection): Map<string, unknown> {
  const value = map[name];
  if (Array.isArray(value)) {
    return new Map(value.map((item: Json) => [String(item.id), item]));
  }
  return new Map(Object.entries((value as Json | undefined) ?? {}));
}

function getIsSame(a: unknown, b: unknown) {
  return a === b || JSON.stringify(a) === JSON.stringify(b);
}

function getIsRecord(value: unknown): value is Json {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
