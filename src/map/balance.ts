import { keyThings, thingCatalog } from "./catalog";
import { activeLineActions } from "./validate";
import type { GameMap, KeyColor, ThingKind, ThingSkill } from "./types";

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
};

const healing: Partial<Record<ThingKind, number>> = {
  stimpack: 10,
  medikit: 25,
  "green-armor": 33,
  "blue-armor": 100,
};

const ammoDamage: Partial<Record<ThingKind, number>> = {
  shotgun: 560,
  chaingun: 200,
  clip: 100,
  shells: 280,
};

function appearsOn(skills: ThingSkill[] | undefined, skill: ThingSkill) {
  return !skills || skills.includes(skill);
}

function sumOf(values: (number | undefined)[]) {
  return values.reduce<number>((total, value) => total + (value ?? 0), 0);
}

function mapBalance(map: GameMap, skill: ThingSkill) {
  const kinds = map.things
    .filter((thing) => appearsOn(thing.skills, skill))
    .map((thing) => thing.kind);
  const enemies = kinds.filter((kind) => enemyStats[kind]);
  const health = kinds.filter((kind) => healing[kind]);
  const ammo = kinds.filter((kind) => ammoDamage[kind]);
  const keys = kinds.filter((kind) => thingCatalog[kind].category === "key");
  const needed = new Set<KeyColor>(
    activeLineActions(map).flatMap(({ action }) =>
      action.key ? [action.key] : [],
    ),
  );
  const healthGap =
    sumOf(enemies.map((kind) => enemyStats[kind]?.threat)) -
    startingHealth -
    sumOf(health.map((kind) => healing[kind]));
  const damageGap =
    sumOf(enemies.map((kind) => enemyStats[kind]?.health)) * ammoMargin -
    startingDamage -
    sumOf(ammo.map((kind) => ammoDamage[kind]));
  return {
    enemies: enemies.length,
    health: health.length,
    ammo: ammo.length,
    keys: keys.length,
    keysNeeded: [...needed].filter((key) => !keys.includes(keyThings[key]))
      .length,
    healthShort: Math.max(0, Math.ceil(healthGap / healthPerPickup)),
    ammoShort: Math.max(0, Math.ceil(damageGap / damagePerPickup)),
  };
}

export { appearsOn, mapBalance };
