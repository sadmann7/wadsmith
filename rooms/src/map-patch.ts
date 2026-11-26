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

// The longest patch a live link sends: as big as a whole map, with room for
// the message around it.
export const maxPatchLength = 5 * 1024 * 1024;

type Collection = (typeof keyed)[number] | (typeof listed)[number];
type Listed = (typeof listed)[number];
type Field = (typeof allowed)[number];

export interface MapPatch {
  // Things added whole, or null for things removed.
  set?: Partial<Record<Collection, Record<string, unknown>>>;
  // The changed fields of things that stay, with null for a field removed.
  merge?: Partial<Record<Collection, Record<string, Json>>>;
  fields?: Partial<Record<Field, unknown>>;
  // The ids of a list in their new order, when the patch moves any of them.
  order?: Partial<Record<Listed, string[]>>;
}

// What turns one map into the other.
export function diffMaps(from: object, to: object): MapPatch {
  const before = from as Json;
  const after = to as Json;
  const set: NonNullable<MapPatch["set"]> = {};
  const merge: NonNullable<MapPatch["merge"]> = {};
  const order: NonNullable<MapPatch["order"]> = {};
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
    if ((listed as readonly string[]).includes(name)) {
      const ids = [...now.keys()];
      const kept = [...was.keys()].filter((key) => now.has(key));
      const joined = ids.filter((key) => !was.has(key));
      if (!getIsSame(ids, [...kept, ...joined])) order[name as Listed] = ids;
    }
  }
  const fields: NonNullable<MapPatch["fields"]> = {};
  for (const name of compared) {
    if (!getIsSame(before[name], after[name])) {
      fields[name] = after[name] ?? null;
    }
  }
  return tidy({ set, merge, fields, order });
}

// The map with the patch applied. A new item joins the end of its list, and
// a change to a thing that is gone does nothing.
export function applyPatch<T extends object>(source: T, patch: MapPatch): T {
  const map = source as Json;
  const next: Json = { ...map };
  const names = new Set([
    ...Object.keys(patch.set ?? {}),
    ...Object.keys(patch.merge ?? {}),
    ...Object.keys(patch.order ?? {}),
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
      const order = patch.order?.[name as Listed];
      if (order) {
        const rank = new Map(order.map((key, at) => [key, at]));
        list.sort(
          (a, b) =>
            (rank.get(String(a.id)) ?? order.length) -
            (rank.get(String(b.id)) ?? order.length),
        );
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
    order: { ...patch.order },
  });
}

export function getIsEmptyPatch(patch: MapPatch) {
  return !patch.set && !patch.merge && !patch.fields && !patch.order;
}

// A patch as the server takes it: only known collections and fields, things
// as objects or null, list items whose id matches their key, and changes
// that keep each item's id.
export function parsePatch(value: unknown): MapPatch | null {
  if (!getIsRecord(value)) return null;
  const { set = {}, merge = {}, fields = {}, order = {} } = value;
  if (
    !getIsRecord(set) ||
    !getIsRecord(merge) ||
    !getIsRecord(fields) ||
    !getIsRecord(order)
  ) {
    return null;
  }
  for (const [name, ids] of Object.entries(order)) {
    if (
      !(listed as readonly string[]).includes(name) ||
      !Array.isArray(ids) ||
      ids.some((id) => typeof id !== "string")
    ) {
      return null;
    }
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

// Letters that end the ids one browser makes while editing online.
export function randomSuffix() {
  return Array.from(crypto.getRandomValues(new Uint8Array(3)), (byte) =>
    String.fromCharCode(97 + (byte % 26)),
  ).join("");
}

// The patch as it lands on the map, or null when it adds something under an
// id the map already gives to something else, as when two people add at the
// same moment. Settings for a wall that someone else just gave its first
// settings join theirs instead of replacing them.
export function fitPatch(source: object, patch: MapPatch): MapPatch | null {
  const map = source as Json;
  const set: NonNullable<MapPatch["set"]> = {};
  const merge: NonNullable<MapPatch["merge"]> = { ...patch.merge };
  for (const [name, added] of Object.entries(patch.set ?? {}) as [
    Collection,
    Record<string, unknown>,
  ][]) {
    const held = entries(map, name);
    const kept: Record<string, unknown> = {};
    const joined: Record<string, Json> = { ...merge[name] };
    for (const [key, value] of Object.entries(added)) {
      const old = held.get(key);
      if (value === null || old === undefined || getIsSame(old, value)) {
        kept[key] = value;
      } else if (name === "lines" && getIsRecord(value)) {
        joined[key] = { ...joined[key], ...value };
      } else return null;
    }
    set[name] = kept;
    merge[name] = joined;
  }
  return tidy({
    set,
    merge,
    fields: { ...patch.fields },
    order: { ...patch.order },
  });
}

// Corners rooms name that the map doesn't have, as when one person draws a
// room against a corner another removed at the same moment.
export function missingCorners(source: object) {
  const map = source as Json;
  const vertices = (map.vertices as Json | undefined) ?? {};
  const missing = new Set<string>();
  for (const sector of (map.sectors as Json[] | undefined) ?? []) {
    const loops = [
      sector.vertices,
      ...((sector.holes as unknown[] | undefined) ?? []),
      ...((sector.details as unknown[] | undefined) ?? []),
    ];
    for (const loop of loops) {
      if (!Array.isArray(loop)) continue;
      for (const id of loop) {
        if (typeof id === "string" && !Object.hasOwn(vertices, id)) {
          missing.add(id);
        }
      }
    }
  }
  return missing;
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
  return tidy({
    set,
    merge,
    fields: { ...first.fields, ...second.fields },
    order: { ...first.order, ...second.order },
  });
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
    ...(Object.keys(patch.order).length > 0 && { order: patch.order }),
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
