import { Focus, LocateFixed, Maximize, StickyNote } from "lucide-react";
import * as React from "react";

import type { MapLink } from "@/lib/map/links";
import type { PlaytestRun, RunMark } from "@/lib/map/playtest";
import type { GameMap, Sector, ThingKind } from "@/lib/map/types";

import { buttonVariants } from "@/components/ui/button";
import { thingIcons } from "@/lib/editor/thing-icons";
import { thingCatalog } from "@/lib/map/catalog";
import { doorKeyPrefix, switchKeyPrefix, thingKeyPrefix } from "@/lib/map/edit";
import { paintOrder, wallOwners } from "@/lib/map/geometry";

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
  MapMarker,
  MapMarquee,
  MapMeasure,
  MapPort,
  MapSector,
  MapWall,
  MapWire,
  MapWorld,
} from "./map-editor";

const worldSize = 65536;
const crowdedRooms = 60;
const farZoom = 0.5;
const labelWidth = 80;
const noSelection: string[] = [];
const nowhere = { left: 0, top: 0, right: -1, bottom: -1 };

interface Area {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

const linkEnd = 4;
const markSize = 4;

interface MapCanvasProps extends React.ComponentProps<typeof MapEditor> {
  map: GameMap;
  callouts: { id: string; x: number; y: number; text: string }[];
  // From the selected line to what it acts on, or to the selected room from
  // the lines that act on it.
  links: MapLink[];
  // The last playtest's paths and marks, or null to leave them off the map.
  trail: PlaytestRun | null;
}

export function MapCanvas({
  map,
  callouts,
  links,
  trail,
  onViewChange,
  ...props
}: MapCanvasProps) {
  const [step, setStep] = React.useState(1);
  const [zoomedOut, setZoomedOut] = React.useState(false);
  const [seen, setSeen] = React.useState<Area | null>(null);
  const crowded = map.sectors.length > crowdedRooms;
  // Zoomed out, a big map's corners and icons would bury its rooms, and every
  // mounted part updates on every pan and zoom.
  const far = crowded && zoomedOut;
  const corners =
    (props.editMode ?? "vertices") === "vertices" &&
    (!far || (props.tool ?? "select") !== "select");
  const labelStep = crowded ? step : Infinity;
  const area = crowded ? (seen ?? nowhere) : null;
  const selection = props.selection ?? noSelection;

  const shapes = React.useMemo(
    () => (
      <>
        {paintOrder(map).map((sector) => (
          <MapSector
            key={sector.id}
            value={sector.id}
            corners={sector.vertices}
            holes={sector.holes}
            door={!!sector.door}
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
            data-detail={wall.detail ? "" : undefined}
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
      </>
    ),
    [map],
  );

  const walked = React.useMemo(
    () =>
      trail?.paths.map((path, index) => (
        <polyline
          // oxlint-disable-next-line react/no-array-index-key -- A run's paths never change order.
          key={index}
          className="map-trail-path"
          data-player={path.player % trailColors}
          points={path.points.join(" ")}
        />
      )),
    [trail],
  );

  const rooms = React.useMemo(
    () =>
      map.sectors
        .filter((sector) => !sector.door)
        .map((sector, index) => ({
          sector,
          number: String(index + 1).padStart(2, "0"),
          box: boxOf(map, sector),
        })),
    [map],
  );

  const labels = React.useMemo(
    () =>
      clearOf(
        rooms.filter(
          ({ box }) =>
            (box.right - box.left) * labelStep >= labelWidth &&
            (!area ||
              (box.right >= area.left &&
                box.left <= area.right &&
                box.bottom >= area.top &&
                box.top <= area.bottom)),
        ),
        labelStep,
      ).map(({ sector, number, box }) => (
        <MapLabel
          key={sector.id}
          value={sector.id}
          corners={sector.vertices}
          className="map-label"
          style={
            { "--room-width": box.right - box.left } as React.CSSProperties
          }
        >
          <strong>{sector.name}</strong>
          <span>
            S{number} {sector.floor}/{sector.ceiling}
          </span>
        </MapLabel>
      )),
    [rooms, labelStep, area],
  );

  const handles = React.useMemo(
    () =>
      Object.entries(map.vertices)
        .filter(
          ([id, point]) =>
            (corners && inArea(area, point)) || selection.includes(id),
        )
        .map(([id]) => id)
        .map((id) => (
          <MapHandle
            key={id}
            value={id}
            className="map-vertex"
            aria-label={`Corner ${id}`}
          />
        )),
    [map, corners, area, selection],
  );

  const things = React.useMemo(
    () =>
      map.things
        .filter(
          (thing) =>
            inArea(area, thing) ||
            selection.includes(`${thingKeyPrefix}${thing.id}`),
        )
        .map((thing) => {
          const { label } = thingCatalog[thing.kind];
          const { style, icon } = thingLook(thing.kind);
          const startNumber = /^player-(\d)$/.exec(thing.kind)?.[1];
          return (
            <MapHandle
              key={thing.id}
              value={`${thingKeyPrefix}${thing.id}`}
              className="map-thing"
              aria-label={label}
              title={label}
              style={style}
            >
              {far ? null : (startNumber ?? icon)}
            </MapHandle>
          );
        }),
    [map, far, area, selection],
  );

  const ports = React.useMemo(
    () => (
      <>
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
      </>
    ),
    [map],
  );

  return (
    <MapEditor
      aria-label="Map"
      className="map"
      map={map}
      data-crowded={crowded ? "" : undefined}
      data-far={far ? "" : undefined}
      onViewChange={(status) => {
        setStep(zoomStep(status.zoom));
        setZoomedOut(status.zoom < farZoom);
        // A hidden pane reports no size, which says nothing about its view.
        if (status.view.right > status.view.left) {
          const next = areaAround(status.view);
          setSeen((current) => (sameArea(current, next) ? current : next));
        }
        onViewChange?.(status);
      }}
      {...props}
    >
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
          {shapes}
          {links.map(({ from, to }) => (
            <g key={`${from.x},${from.y},${to.x},${to.y}`}>
              <line
                className="map-link"
                x1={from.x}
                y1={from.y}
                x2={to.x}
                y2={to.y}
              />
              <circle
                className="map-link-end"
                cx={to.x}
                cy={to.y}
                r={linkEnd / step}
              />
            </g>
          ))}
          {walked}
          {trail?.marks.map((mark, index) => (
            <TrailMark
              // oxlint-disable-next-line react/no-array-index-key -- A run's marks never change order.
              key={index}
              mark={mark}
              size={markSize / step}
            />
          ))}
          <MapConnecting className="map-wire map-connecting" />
          <MapDraft className="map-draft" />
        </svg>
        {labels}
        {handles}
        {things}
        {ports}
        <MapMarquee className="map-marquee" />
        <MapMeasure className="pointer-events-none origin-top-left [transform:scale(calc(1/var(--canvas-zoom,1)))_translate(12px,12px)] rounded-[3px] border border-border bg-popover px-1.5 py-0.5 font-mono text-xs whitespace-nowrap text-foreground after:content-[attr(data-measure)]" />
        {map.notes?.map((note) => (
          <MapMarker
            key={note.id}
            value={note.id}
            x={note.x}
            y={note.y}
            title={note.text}
            className="pointer-events-none flex size-5 origin-center [transform:translate(-50%,-50%)_scale(calc(1/var(--canvas-zoom,1)))] items-center justify-center rounded-[3px] bg-map-note text-primary-foreground"
          >
            <StickyNote size={12} aria-hidden="true" />
          </MapMarker>
        ))}
        {callouts.map((callout) => (
          <MapMarker
            key={callout.id}
            value={callout.id}
            x={callout.x}
            y={callout.y}
            className="pointer-events-none origin-bottom-left [transform:translateY(-100%)_scale(calc(1/var(--canvas-zoom,1)))] border border-destructive bg-destructive/15 px-2 py-1 font-mono text-xs whitespace-nowrap text-foreground"
          >
            {callout.text}
          </MapMarker>
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
          className={buttonVariants({ variant: "outline", size: "icon" })}
          aria-label="Look here"
          title="Look here"
        >
          <Focus size={16} aria-hidden="true" />
        </MapLookHere>
        <MapFindCamera
          className={buttonVariants({ variant: "outline", size: "icon" })}
          aria-label="Find camera"
          title="Find camera"
        >
          <LocateFixed size={16} aria-hidden="true" />
        </MapFindCamera>
        <MapFit
          className={buttonVariants({ variant: "outline", size: "icon" })}
          aria-label="Fit map"
          title="Fit map"
        >
          <Maximize size={16} aria-hidden="true" />
        </MapFit>
      </div>
    </MapEditor>
  );
}

function wallsOf(map: GameMap) {
  return [...wallOwners(map)].map(([key, owners]) => {
    const [from, to] = key.split("|");
    return {
      key,
      from,
      to,
      shared: owners.length > 1,
      detail: owners.length === 2 && owners[0] === owners[1],
    };
  });
}

function boxOf(map: GameMap, sector: GameMap["sectors"][number]): Area {
  const points = sector.vertices.map((id) => map.vertices[id]);
  const xs = points.map((point) => point.x);
  const ys = points.map((point) => point.y);
  return {
    left: Math.min(...xs),
    top: Math.min(...ys),
    right: Math.max(...xs),
    bottom: Math.max(...ys),
  };
}

// A crowded map keeps the bigger room's label where two would overlap. The
// sizes are rough, from the name's length, and the zoom step can run up to a
// fifth over the zoom, so they're scaled up to match.
function clearOf<Room extends { sector: Sector; box: Area }>(
  rooms: Room[],
  zoom: number,
) {
  if (!Number.isFinite(zoom)) return rooms;
  const scale = 1.2 / zoom;
  const placed: Area[] = [];
  const kept = new Set(
    rooms
      .toSorted(
        (a, b) =>
          (b.box.right - b.box.left) * (b.box.bottom - b.box.top) -
          (a.box.right - a.box.left) * (a.box.bottom - a.box.top),
      )
      .filter(({ sector, box }) => {
        const halfWidth = ((sector.name.length * 7.5 + 8) / 2) * scale;
        const x = (box.left + box.right) / 2;
        const y = box.top + 24 / zoom;
        const label = {
          left: x - halfWidth,
          right: x + halfWidth,
          top: y - 10 * scale,
          bottom: y + 10 * scale,
        };
        if (
          placed.some(
            (other) =>
              label.left < other.right &&
              label.right > other.left &&
              label.top < other.bottom &&
              label.bottom > other.top,
          )
        ) {
          return false;
        }
        placed.push(label);
        return true;
      }),
  );
  return rooms.filter((room) => kept.has(room));
}

function inArea(area: Area | null, { x, y }: { x: number; y: number }) {
  return (
    !area ||
    (x >= area.left && x <= area.right && y >= area.top && y <= area.bottom)
  );
}

const thingLooks = new Map<
  ThingKind,
  { style: React.CSSProperties; icon: React.ReactElement }
>();

// A thing part renders again only when a prop changes, so a kind's style and
// icon are made once and shared.
function thingLook(kind: ThingKind) {
  let look = thingLooks.get(kind);
  if (!look) {
    const { icon: Icon, color } = thingIcons[kind];
    look = {
      style: { "--thing-color": color } as React.CSSProperties,
      icon: <Icon size={13} aria-hidden="true" />,
    };
    thingLooks.set(kind, look);
  }
  return look;
}

// Doom gives its four players a color each, and a path wears its player's.
const trailColors = 4;

// A hit's mark grows with the damage, up to this many times its size.
const heavyHit = 40;
const hitGrowth = 2;

interface TrailMarkProps {
  mark: RunMark;
  size: number;
}

function TrailMark({ mark, size }: TrailMarkProps) {
  const { kind, x, y, value } = mark;
  if (kind === "death") {
    return (
      <path
        className="map-trail-death"
        d={`M${x - size} ${y - size}L${x + size} ${y + size}M${x + size} ${y - size}L${x - size} ${y + size}`}
      />
    );
  }
  const grown =
    kind === "damage"
      ? 1 + (Math.min(value, heavyHit) / heavyHit) * (hitGrowth - 1)
      : 1;
  return (
    <circle className={`map-trail-${kind}`} cx={x} cy={y} r={size * grown} />
  );
}

// Zoom in quarter octaves, rounded up, so the canvas renders again only when
// the zoom crosses a step.
function zoomStep(zoom: number) {
  return 2 ** (Math.ceil(Math.log2(zoom) * 4) / 4);
}

// The view grown by a cell of at least half its size on every side and
// snapped to those cells, so panning renders again only after crossing one.
function areaAround(view: Area): Area {
  const cell =
    2 **
    Math.ceil(
      Math.log2(
        Math.max(view.right - view.left, view.bottom - view.top, 2) / 2,
      ),
    );
  return {
    left: (Math.floor(view.left / cell) - 1) * cell,
    top: (Math.floor(view.top / cell) - 1) * cell,
    right: (Math.ceil(view.right / cell) + 1) * cell,
    bottom: (Math.ceil(view.bottom / cell) + 1) * cell,
  };
}

function sameArea(a: Area | null, b: Area) {
  return (
    a !== null &&
    a.left === b.left &&
    a.top === b.top &&
    a.right === b.right &&
    a.bottom === b.bottom
  );
}
