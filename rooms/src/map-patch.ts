// A change to a map as the things it adds, removes or changes, and for a
// changed thing only the fields that changed, so two people's edits to
// different things, or to different fields of one thing, combine, and the
// later of two edits to one field wins. It works on a map as plain JSON, so
// the editor and the rooms server share it.

type Json = Record<string, unknown>;

// Collections kept by key, and collections kept as lists of items with ids.
const keyed = ["vertices", "lines"] as const;
const listed = ["sectors", "things", "switches", "notes"] as const;
// Fields of the map itself that an edit compares. Its name changes through
// its settings, which send it on its own.
const compared = ["complevel"] as const;
const allowed = ["complevel", "name"] as const;

type Collection = (typeof keyed)[number] | (typeof listed)[number];
type Field = (typeof allowed)[number];

export interface MapPatch {
  // Things added whole, or null for things removed.
  set?: Partial<Record<Collection, Record<string, unknown>>>;
  // The changed fields of things that stay, with null for a field removed.
  merge?: Partial<Record<Collection, Record<string, Json>>>;
  fields?: Partial<Record<Field, unknown>>;
}

// What turns one map into the other.
export function diffMaps(from: object, to: object): MapPatch {
  const before = from as Json;
  const after = to as Json;
  const set: NonNullable<MapPatch["set"]> = {};
  const merge: NonNullable<MapPatch["merge"]> = {};
  for (const name of [...keyed, ...listed]) {
    const was = entries(before, name);
    const now = entries(after, name);
    const added: Record<string, unknown> = {};
    const changed: Record<string, Json> = {};
    for (const [key, value] of now) {
      const old = was.get(key);
      if (old === value) continue;
      if (!getIsRecord(old) || !getIsRecord(value)) {
        if (!getIsSame(old, value)) added[key] = value;
        continue;
      }
      const fields: Json = {};
      for (const field of new Set([
        ...Object.keys(old),
        ...Object.keys(value),
      ])) {
        if (!getIsSame(old[field], value[field])) {
          fields[field] = value[field] ?? null;
        }
      }
      if (Object.keys(fields).length > 0) changed[key] = fields;
    }
    for (const key of was.keys()) {
      if (!now.has(key)) added[key] = null;
    }
    if (Object.keys(added).length > 0) set[name] = added;
    if (Object.keys(changed).length > 0) merge[name] = changed;
  }
  const fields: NonNullable<MapPatch["fields"]> = {};
  for (const name of compared) {
    if (!getIsSame(before[name], after[name])) {
      fields[name] = after[name] ?? null;
    }
  }
  return tidy({ set, merge, fields });
}

// The map with the patch applied. A new item joins the end of its list, and
// a change to a thing that is gone does nothing.
export function applyPatch<T extends object>(source: T, patch: MapPatch): T {
  const map = source as Json;
  const next: Json = { ...map };
  const names = new Set([
    ...Object.keys(patch.set ?? {}),
    ...Object.keys(patch.merge ?? {}),
  ]);
  for (const name of names) {
    const added = patch.set?.[name as Collection] ?? {};
    const changed = patch.merge?.[name as Collection] ?? {};
    if ((keyed as readonly string[]).includes(name)) {
      const record = { ...(map[name] as Json | undefined) };
      for (const [key, value] of Object.entries(added)) {
        if (value === null) delete record[key];
        else record[key] = value;
      }
      for (const [key, fields] of Object.entries(changed)) {
        const old = record[key];
        if (getIsRecord(old)) record[key] = merged(old, fields);
      }
      if (name === "lines" && Object.keys(record).length === 0) {
        delete next[name];
      } else next[name] = record;
    } else if ((listed as readonly string[]).includes(name)) {
      const list = [...((map[name] as Json[] | undefined) ?? [])];
      for (const [key, value] of Object.entries(added)) {
        const at = list.findIndex((item) => item.id === key);
        if (value === null) {
          if (at >= 0) list.splice(at, 1);
        } else if (at >= 0) list[at] = value as Json;
        else list.push(value as Json);
      }
      for (const [key, fields] of Object.entries(changed)) {
        const at = list.findIndex((item) => item.id === key);
        if (at >= 0) list[at] = merged(list[at], fields);
      }
      if (name === "notes" && list.length === 0) delete next[name];
      else next[name] = list;
    }
  }
  for (const [name, value] of Object.entries(patch.fields ?? {})) {
    if (!(allowed as readonly string[]).includes(name)) continue;
    if (value === null) delete next[name];
    else next[name] = value;
  }
  return next as T;
}

// Every thing a patch touches, as "collection:key" or "field:name".
export function patchKeys(patch: MapPatch) {
  const keys = new Set<string>();
  for (const part of [patch.set, patch.merge]) {
    for (const [name, changes] of Object.entries(part ?? {})) {
      for (const key of Object.keys(changes ?? {})) keys.add(`${name}:${key}`);
    }
  }
  for (const name of Object.keys(patch.fields ?? {})) keys.add(`field:${name}`);
  return [...keys];
}

// The patch without the things named, as when they hold edits of one's own
// that the server orders after it.
export function withoutKeys(patch: MapPatch, skip: ReadonlySet<string>) {
  const keep = <V>(part: Partial<Record<Collection, Record<string, V>>>) =>
    Object.fromEntries(
      Object.entries(part).map(([name, changes]) => [
        name,
        Object.fromEntries(
          Object.entries(changes ?? {}).filter(
            ([key]) => !skip.has(`${name}:${key}`),
          ),
        ),
      ]),
    ) as Partial<Record<Collection, Record<string, V>>>;
  return tidy({
    set: keep(patch.set ?? {}),
    merge: keep(patch.merge ?? {}),
    fields: Object.fromEntries(
      Object.entries(patch.fields ?? {}).filter(
        ([name]) => !skip.has(`field:${name}`),
      ),
    ),
  });
}

export function getIsEmptyPatch(patch: MapPatch) {
  return !patch.set && !patch.merge && !patch.fields;
}

// A patch as the server takes it: only known collections and fields, things
// as objects or null, list items whose id matches their key, and changes
// that keep each item's id.
export function parsePatch(value: unknown): MapPatch | null {
  if (!getIsRecord(value)) return null;
  const { set = {}, merge = {}, fields = {} } = value;
  if (!getIsRecord(set) || !getIsRecord(merge) || !getIsRecord(fields)) {
    return null;
  }
  for (const [part, whole] of [
    [set, true],
    [merge, false],
  ] as const) {
    for (const [name, changes] of Object.entries(part)) {
      const isListed = (listed as readonly string[]).includes(name);
      if (!isListed && !(keyed as readonly string[]).includes(name)) {
        return null;
      }
      if (!getIsRecord(changes)) return null;
      for (const [key, entity] of Object.entries(changes)) {
        if (key === "__proto__" || key.length > 200) return null;
        if (whole && entity === null) continue;
        if (!getIsRecord(entity)) return null;
        if (whole && isListed && entity.id !== key) return null;
        if (
          !whole &&
          (Object.hasOwn(entity, "id") || Object.hasOwn(entity, "__proto__"))
        ) {
          return null;
        }
      }
    }
  }
  for (const name of Object.keys(fields)) {
    if (!(allowed as readonly string[]).includes(name)) return null;
  }
  return value;
}

// One patch that does both, the second winning where they touch one field.
export function combinePatches(first: MapPatch, second: MapPatch): MapPatch {
  const set: NonNullable<MapPatch["set"]> = {};
  const merge: NonNullable<MapPatch["merge"]> = {};
  for (const name of [...keyed, ...listed]) {
    const added = { ...first.set?.[name] };
    const changed = { ...first.merge?.[name] };
    for (const [key, value] of Object.entries(second.set?.[name] ?? {})) {
      added[key] = value;
      delete changed[key];
    }
    for (const [key, fields] of Object.entries(second.merge?.[name] ?? {})) {
      const whole = added[key];
      if (getIsRecord(whole)) added[key] = merged(whole, fields);
      else if (whole === null) continue;
      else changed[key] = { ...changed[key], ...fields };
    }
    set[name] = added;
    merge[name] = changed;
  }
  return tidy({ set, merge, fields: { ...first.fields, ...second.fields } });
}

function merged(entity: Json, fields: Json) {
  const next = { ...entity };
  for (const [field, value] of Object.entries(fields)) {
    if (value === null) delete next[field];
    else next[field] = value;
  }
  return next;
}

function tidy(patch: Required<MapPatch>): MapPatch {
  const set = parts(patch.set);
  const merge = parts(patch.merge);
  return {
    ...(Object.keys(set).length > 0 && { set }),
    ...(Object.keys(merge).length > 0 && { merge }),
    ...(Object.keys(patch.fields).length > 0 && { fields: patch.fields }),
  };
}

function parts(part: Record<string, Record<string, unknown> | undefined>) {
  return Object.fromEntries(
    Object.entries(part).filter(
      ([, changes]) => Object.keys(changes ?? {}).length > 0,
    ),
  );
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
