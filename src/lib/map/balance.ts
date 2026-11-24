import type { CustomThings } from "@/lib/wad/custom-things";

import type { GameMap, KeyColor, ThingKind, ThingSkill } from "./types";

import { keyThings, thingCatalog } from "./catalog";
import { activeLineActions } from "./validate";

const startingHealth = 60;
const startingDamage = 500;
const ammoMargin = 1.5;
const healthPerPickup = 25;
const damagePerPickup = 100;

const enemyStats: Partial<
  Record<ThingKind, { health: number; threat: number }>
> = {
  imp: { health: 60, threat: 12 },
  zombieman: { health: 20, threat: 8 },
  "shotgun-guy": { health: 30, threat: 12 },
  demon: { health: 150, threat: 15 },
  spectre: { health: 150, threat: 20 },
  "lost-soul": { health: 100, threat: 15 },
  chaingunner: { health: 70, threat: 20 },
  "pain-elemental": { health: 400, threat: 40 },
  "wolfenstein-ss": { health: 50, threat: 12 },
  cacodemon: { health: 400, threat: 30 },
  "hell-knight": { health: 500, threat: 35 },
  "baron-of-hell": { health: 1000, threat: 50 },
  arachnotron: { health: 500, threat: 40 },
  revenant: { health: 300, threat: 40 },
  mancubus: { health: 600, threat: 50 },
  "arch-vile": { health: 700, threat: 80 },
  "spider-mastermind": { health: 3000, threat: 150 },
  cyberdemon: { health: 4000, threat: 200 },
};

const healing: Partial<Record<ThingKind, number>> = {
  stimpack: 10,
  medikit: 25,
  "green-armor": 33,
  "blue-armor": 100,
  "health-bonus": 1,
  "armor-bonus": 1,
  berserk: 100,
  soulsphere: 100,
  megasphere: 200,
};

const ammoDamage: Partial<Record<ThingKind, number>> = {
  shotgun: 560,
  chaingun: 200,
  clip: 100,
  shells: 280,
  "box-of-bullets": 500,
  "box-of-shells": 1400,
  "super-shotgun": 560,
  rocket: 130,
  "box-of-rockets": 650,
  "rocket-launcher": 260,
  cell: 440,
  "cell-pack": 2200,
  "plasma-gun": 880,
  "bfg-9000": 880,
  backpack: 950,
};

export function appearsOn(skills: ThingSkill[] | undefined, skill: ThingSkill) {
  return !skills || skills.includes(skill);
}

export function mapBalance(
  map: GameMap,
  skill: ThingSkill,
  custom: CustomThings = new Map(),
) {
  const placed = map.things.filter((thing) => appearsOn(thing.skills, skill));
  const kinds = placed.map((thing) => thing.kind);
  const enemies = placed.flatMap((thing) => {
    if (thing.kind !== "custom") return enemyStats[thing.kind] ?? [];
    const patched = custom.get(thing.type ?? 0);
    return patched?.category === "enemy" ? [customStats(patched.health)] : [];
  });
  const health = kinds.filter((kind) => healing[kind]);
  const ammo = kinds.filter((kind) => ammoDamage[kind]);
  const keys = kinds.filter((kind) => thingCatalog[kind].category === "key");
  const needed = new Set<KeyColor>(
    activeLineActions(map).flatMap(({ action }) =>
      action.key ? [action.key] : [],
    ),
  );
  const healthGap =
    sumOf(enemies.map((enemy) => enemy.threat)) -
    startingHealth -
    sumOf(health.map((kind) => healing[kind]));
  const damageGap =
    sumOf(enemies.map((enemy) => enemy.health)) * ammoMargin -
    startingDamage -
    sumOf(ammo.map((kind) => ammoDamage[kind]));
  return {
    enemies: enemies.length,
    health: health.length,
    ammo: ammo.length,
    keys: keys.length,
    keysNeeded: needed.size,
    keysMissing: [...needed].filter(
      (key) => !keyThings[key].some((kind) => keys.includes(kind)),
    ).length,
    healthShort: Math.max(0, Math.ceil(healthGap / healthPerPickup)),
    ammoShort: Math.max(0, Math.ceil(damageGap / damagePerPickup)),
  };
}

// A custom monster's threat grows with its hit points about as the stock
// monsters' does.
function customStats(health: number) {
  return { health, threat: Math.round(1.5 * Math.sqrt(Math.max(0, health))) };
}

function sumOf(values: (number | undefined)[]) {
  return values.reduce<number>((total, value) => total + (value ?? 0), 0);
}
