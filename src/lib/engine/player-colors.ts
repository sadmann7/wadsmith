interface PlayerColor {
  fill: string;
  badge: string;
}

const green: PlayerColor = {
  fill: "var(--color-success)",
  badge: "border-success text-success",
};

// Doom colors players by game slot: green, indigo, brown and red.
const playerColors: PlayerColor[] = [
  green,
  { fill: "var(--color-info)", badge: "border-info text-info" },
  { fill: "var(--color-warning)", badge: "border-warning text-warning" },
  {
    fill: "var(--color-destructive)",
    badge: "border-destructive text-destructive",
  },
];

export function playerColor(slot: number) {
  return playerColors[slot] ?? green;
}
