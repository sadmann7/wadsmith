import { Check } from "lucide-react";

import { roomDefaults } from "@/lib/map/edit";
import { hasExit } from "@/lib/map/checks";
import { sectorAt } from "@/lib/map/geometry";
import type { GameMap } from "@/lib/map/types";

interface NewMapPanelProps {
  map: GameMap;
  corners: number;
  drawing: boolean;
}

export function NewMapPanel({ map, corners, drawing }: NewMapPanelProps) {
  const room = roomDefaults(map.sectors.length + 1);
  const steps = [
    {
      title: "Close your first room",
      hint: "Finish the shape on the map",
      done: map.sectors.length > 0,
    },
    {
      title: "Place a player start",
      hint: "Things mode, press T",
      done: map.things.some(
        (thing) => thing.kind === "player" && sectorAt(map, thing),
      ),
    },
    {
      title: "Add an exit",
      hint: "Optional, a line with an exit action",
      done: hasExit(map),
      optional: true,
    },
  ];
  const required = steps.filter((step) => !step.optional);
  const finished = required.filter((step) => step.done).length;
  const defaults = [
    ["Floor height", room.floor],
    ["Ceiling height", room.ceiling],
    ["Light level", room.light],
    ["Floor texture", room.floorTexture],
    ["Wall texture", room.wallTexture],
  ];
  return (
    <>
      {drawing ? (
        <section className="inspector-section" aria-label="New sector">
          <h2>
            This sector will use
            <span>
              {corners} {corners === 1 ? "corner" : "corners"}
            </span>
          </h2>
          <dl className="m-0 grid grid-cols-[1fr_auto] gap-x-3 gap-y-1.5">
            {defaults.map(([label, value]) => (
              <div key={label} className="contents">
                <dt className="text-muted-foreground">{label}</dt>
                <dd className="m-0 font-mono text-xs">{value}</dd>
              </div>
            ))}
          </dl>
        </section>
      ) : null}
      {steps.some((step) => !step.done) ? (
        <section className="inspector-section" aria-label="Before you can play">
          <h2>
            Before you can play
            <span>
              {finished} of {required.length}
            </span>
          </h2>
          <ol className="m-0 grid list-none gap-2 p-0">
            {steps.map((step) => (
              <li key={step.title} className="flex gap-2">
                <span
                  data-done={step.done ? "" : undefined}
                  className="mt-0.5 flex size-4 shrink-0 items-center justify-center rounded-full border border-border text-primary-foreground data-[done]:border-primary data-[done]:bg-primary"
                >
                  {step.done ? <Check size={11} aria-hidden="true" /> : null}
                </span>
                <div>
                  <div>
                    <span className="sr-only">
                      {step.done ? "Done: " : "To do: "}
                    </span>
                    {step.title}
                  </div>
                  <div className="font-mono text-xs text-muted-foreground">
                    {step.hint}
                  </div>
                </div>
              </li>
            ))}
          </ol>
        </section>
      ) : null}
    </>
  );
}
