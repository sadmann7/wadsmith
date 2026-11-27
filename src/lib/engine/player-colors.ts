interface PlayerColor {
  fill: string;
  badge: string;
  dot: string;
}

const green: PlayerColor = {
  fill: "var(--color-success)",
  badge: "border-success text-success",
  dot: "bg-success",
};

// Doom colors players by game slot: green, indigo, brown and red.
const playerColors: PlayerColor[] = [
  green,
  {
    fill: "var(--color-info)",
    badge: "border-info text-info",
    dot: "bg-info",
  },
  {
    fill: "var(--color-warning)",
    badge: "border-warning text-warning",
    dot: "bg-warning",
  },
  {
    fill: "var(--color-destructive)",
    badge: "border-destructive text-destructive",
    dot: "bg-destructive",
  },
];

export function playerColor(slot: number) {
  return playerColors[slot % playerColors.length] ?? green;
}
