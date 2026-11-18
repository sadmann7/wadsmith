import {
  ArrowRight,
  Box,
  Crosshair,
  Focus,
  LocateFixed,
  Maximize,
  Plus,
  Skull,
  type LucideIcon,
} from "lucide-react";
import type { ComponentProps, CSSProperties } from "react";

import { thingCatalog } from "../map/catalog";
import { doorKeyPrefix, switchKeyPrefix, thingKeyPrefix } from "../map/edit";
import { sectorEdges } from "../map/geometry";
import type { GameMap, ThingKind } from "../map/types";
import {
  MapCamera,
  MapConnecting,
  MapDraft,
  MapEditor,
  MapFindCamera,
  MapFit,
  MapHandle,
  MapLabel,
  MapLookHere,
  MapPort,
  MapSector,
  MapWall,
  MapWire,
  MapWorld,
} from "./map-editor";

const worldSize = 65536;

const thingStyles: Record<ThingKind, { icon: LucideIcon; color: string }> = {
  player: { icon: ArrowRight, color: "var(--key)" },
  zombieman: { icon: Skull, color: "var(--danger)" },
  "shotgun-guy": { icon: Skull, color: "var(--danger)" },
  imp: { icon: Skull, color: "var(--danger)" },
  demon: { icon: Skull, color: "var(--danger)" },
  shotgun: { icon: Crosshair, color: "var(--acid)" },
  shells: { icon: Box, color: "var(--acid)" },
  medikit: { icon: Plus, color: "var(--cold)" },
};

function wallsOf(map: GameMap) {
  const walls = new Map<
    string,
    { from: string; to: string; shared: boolean }
  >();
  for (const sector of map.sectors) {
    for (const { from, to } of sectorEdges(sector)) {
      const key = from < to ? `${from}|${to}` : `${to}|${from}`;
      const wall = walls.get(key);
      if (wall) wall.shared = true;
      else walls.set(key, { from, to, shared: false });
    }
  }
  return [...walls].map(([key, wall]) => ({ key, ...wall }));
}

function MapCanvas({
  map,
  ...props
}: ComponentProps<typeof MapEditor> & { map: GameMap }) {
  return (
    <MapEditor aria-label="Map" className="map" map={map} {...props}>
      <MapWorld className="map-world">
        <svg className="map-svg" width="1" height="1" aria-hidden="true">
          <defs>
            <pattern
              id="map-grid"
              width="64"
              height="64"
              patternUnits="userSpaceOnUse"
            >
              <path d="M64 0H0V64" className="map-grid-line" />
            </pattern>
          </defs>
          <rect
            x={-worldSize / 2}
            y={-worldSize / 2}
            width={worldSize}
            height={worldSize}
            fill="url(#map-grid)"
          />
          {map.sectors.map((sector) => (
            <MapSector
              key={sector.id}
              value={sector.id}
              className="map-sector"
            />
          ))}
          {wallsOf(map).map((wall) => (
            <MapWall
              key={wall.key}
              value={wall.key}
              from={wall.from}
              to={wall.to}
              className="map-wall"
              data-portal={wall.shared ? "" : undefined}
            />
          ))}
          {map.switches.flatMap((item) =>
            item.door
              ? [
                  <MapWire
                    key={item.id}
                    value={item.id}
                    from={`${switchKeyPrefix}${item.id}`}
                    to={`${doorKeyPrefix}${item.door}`}
                    className="map-wire"
                  />,
                ]
              : [],
          )}
          <MapConnecting className="map-wire map-connecting" />
          <MapDraft className="map-draft" />
        </svg>
        {map.sectors
          .filter((sector) => !sector.door)
          .map((sector, index) => (
            <MapLabel key={sector.id} value={sector.id} className="map-label">
              <strong>{sector.name}</strong>
              <span>
                S{String(index + 1).padStart(2, "0")} {sector.floor}/
                {sector.ceiling}
              </span>
            </MapLabel>
          ))}
        {Object.keys(map.vertices).map((id) => (
          <MapHandle
            key={id}
            value={id}
            className="map-vertex"
            aria-label={`Corner ${id}`}
          />
        ))}
        {map.things.map((thing) => {
          const { label } = thingCatalog[thing.kind];
          const { icon: Icon, color } = thingStyles[thing.kind];
          return (
            <MapHandle
              key={thing.id}
              value={`${thingKeyPrefix}${thing.id}`}
              className="map-thing"
              aria-label={label}
              title={label}
              style={{ "--thing-color": color } as CSSProperties}
            >
              <Icon size={13} aria-hidden="true" />
            </MapHandle>
          );
        })}
        {map.sectors
          .filter((sector) => sector.door)
          .map((sector) => (
            <MapPort
              key={sector.id}
              value={`${doorKeyPrefix}${sector.id}`}
              className="map-port map-door"
              aria-label={`Door: ${sector.name}`}
              title={sector.name}
            />
          ))}
        {map.switches.map((item) => (
          <MapPort
            key={item.id}
            value={`${switchKeyPrefix}${item.id}`}
            className="map-port map-switch"
            aria-label={`Switch ${item.id}. Drag to a door, or press C.`}
            title="Drag to a door"
          />
        ))}
        <MapCamera
          className="map-camera"
          aria-label="3D camera. Drag it, or use the arrow keys, to move the view."
          title="3D camera"
        >
          <span className="map-camera-cone" aria-hidden="true" />
          <span className="map-camera-arrow" aria-hidden="true" />
        </MapCamera>
      </MapWorld>
      <div className="map-actions">
        <MapLookHere
          className="icon-button"
          aria-label="Look here"
          title="Look here"
        >
          <Focus size={16} aria-hidden="true" />
        </MapLookHere>
        <MapFindCamera
          className="icon-button"
          aria-label="Find camera"
          title="Find camera"
        >
          <LocateFixed size={16} aria-hidden="true" />
        </MapFindCamera>
        <MapFit className="icon-button" aria-label="Fit map" title="Fit map">
          <Maximize size={16} aria-hidden="true" />
        </MapFit>
      </div>
    </MapEditor>
  );
}

export { MapCanvas };
