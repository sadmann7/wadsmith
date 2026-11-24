import type { Box } from "./fit-view";

const labelInset = 24;

interface LabelRoom {
  name: string;
  detail?: string;
  box: Box;
}

// Keeps the bigger room's label where two would overlap. The sizes are rough,
// from the text's length, and the zoom step can run up to a fifth over the
// zoom, so they're scaled up to match.
export function clearLabels<Room extends LabelRoom>(
  rooms: Room[],
  zoom: number,
) {
  const scale = 1.2 / zoom;
  const placed: Box[] = [];
  const kept = new Set(
    rooms
      .toSorted((a, b) => areaOf(b.box) - areaOf(a.box))
      .filter(({ name, detail, box }) => {
        const width = Math.max(name.length * 7.5, (detail?.length ?? 0) * 6.6);
        const halfWidth = ((width + 8) / 2) * scale;
        const halfHeight = (detail ? 16 : 10) * scale;
        const x = (box.left + box.right) / 2;
        const y = box.top + labelInset / zoom;
        const label = {
          left: x - halfWidth,
          right: x + halfWidth,
          top: y - halfHeight,
          bottom: y + halfHeight,
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

function areaOf(box: Box) {
  return (box.right - box.left) * (box.bottom - box.top);
}
