import { sectorAt } from "@/lib/map/geometry";
import type { GameMap, Point } from "@/lib/map/types";
import { startCamera, type Camera } from "./render";

export class SceneCamera {
  walked = false;
  private current: Camera;
  private readonly listeners = new Set<() => void>();

  constructor(map: GameMap) {
    this.current = startCamera(map);
  }

  get position() {
    return this.current;
  }

  set position(next: Camera) {
    const { x, y, angle } = this.current;
    if (next.x === x && next.y === y && next.angle === angle) return;
    this.current = next;
    for (const listener of this.listeners) listener();
  }

  subscribe(listener: () => void) {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  // Until someone walks, the camera stands on the player start. A drag in
  // progress can leave it outside a room for a moment, so it only resets on
  // committed maps.
  sync(map: GameMap, isDraft = false) {
    if (!this.walked || (!isDraft && !sectorAt(map, this.current))) {
      this.walked = false;
      this.position = startCamera(map);
    }
  }

  reset(map: GameMap) {
    this.walked = false;
    this.position = startCamera(map);
  }

  moveTo(map: GameMap, point: Point) {
    const sector = sectorAt(map, point);
    if (!sector || sector.door) return false;
    this.walked = true;
    this.position = { ...this.current, x: point.x, y: point.y };
    return true;
  }

  placeAt(map: GameMap, point: Point, angle: number) {
    const sector = sectorAt(map, point);
    if (!sector || sector.door) return false;
    this.walked = true;
    this.position = { ...this.current, ...point, angle };
    return true;
  }

  lookAt(map: GameMap, from: Point, target: Point | null) {
    const sector = sectorAt(map, from);
    if (!sector || sector.door) return false;
    const angle = target
      ? (Math.atan2(from.y - target.y, target.x - from.x) * 180) / Math.PI
      : this.current.angle;
    this.walked = true;
    this.position = { ...this.current, ...from, angle };
    return true;
  }
}
