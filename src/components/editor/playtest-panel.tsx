import * as React from "react";

import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import {
  formatTics,
  killersOf,
  percentOf,
  runSummary,
  type SavedPlaytest,
  suggestedPar,
  ticsPerSecond,
} from "@/lib/map/playtest";

// Doom's own player colors: green, indigo, brown and red.
const playerColors = ["bg-success", "bg-info", "bg-warning", "bg-destructive"];

interface PlaytestPanelProps {
  saved: SavedPlaytest;
  shown: boolean;
  par: number | null;
  onShownChange: (shown: boolean) => void;
  onParChange: (par: number) => void;
  onClear: () => void;
}

export function PlaytestPanel({
  saved,
  shown,
  par,
  onShownChange,
  onParChange,
  onClear,
}: PlaytestPanelProps) {
  const { run, best } = saved;
  const { result } = run;
  const { deaths, damage, pickups } = runSummary(run);
  const suggested = best === null ? null : suggestedPar(best);
  const rows = [
    ["Time to exit", result ? formatTics(result.tics) : "Didn't reach it"],
    ...(result
      ? [
          ["Kills", share(result.kills, result.totalKills)],
          ["Secrets", share(result.secrets, result.totalSecrets)],
          ["Items", share(result.items, result.totalItems)],
        ]
      : []),
    ["Deaths", String(deaths)],
    ...(deaths > 0
      ? [
          [
            "Killed by",
            killersOf(run)
              .map(({ name, count }) =>
                count > 1 ? `${name} ×${count}` : name,
              )
              .join(", "),
          ],
        ]
      : []),
    ["Damage taken", String(damage)],
    ["Pickups", String(pickups)],
  ];
  return (
    <section className="inspector-section" aria-label="Last playtest">
      <h2>
        Last playtest
        <span>
          {new Date(run.at).toLocaleTimeString([], {
            hour: "numeric",
            minute: "2-digit",
          })}
        </span>
      </h2>
      <dl className="m-0 grid grid-cols-[minmax(0,1fr)_auto] gap-x-3 gap-y-1">
        {rows.map(([label, value]) => (
          <React.Fragment key={label}>
            <dt className="text-muted-foreground">{label}</dt>
            <dd className="m-0 text-right font-mono">{value}</dd>
          </React.Fragment>
        ))}
      </dl>
      {run.players.length > 1 ? (
        <ul className="m-0 flex list-none flex-wrap gap-x-3 gap-y-1 p-0">
          {run.players.map((player) => (
            <li key={player} className="flex items-center gap-1.5">
              <span
                aria-hidden="true"
                className={`size-2 rounded-full ${playerColors[player % playerColors.length]}`}
              />
              Player {player + 1}
            </li>
          ))}
        </ul>
      ) : null}
      {suggested === null ? null : (
        <p className="m-0 flex items-center justify-between gap-2">
          <span>
            Suggested par{" "}
            <span className="font-mono">
              {formatTics(suggested * ticsPerSecond)}
            </span>
          </span>
          {suggested === par ? null : (
            <Button onClick={() => onParChange(suggested)}>Use as par</Button>
          )}
        </p>
      )}
      <label className="flex items-center justify-between gap-2">
        Show on the map
        <Switch checked={shown} onCheckedChange={onShownChange} />
      </label>
      <Button onClick={onClear}>Clear playtest</Button>
    </section>
  );
}

function share(count: number, total: number) {
  const percent = percentOf(count, total);
  return percent === null ? "None" : `${count}/${total} · ${percent}%`;
}
