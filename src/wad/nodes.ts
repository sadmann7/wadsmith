import type { Point } from "../map/types";

type NodeLine = {
  start: number;
  end: number;
  frontSector: number;
  backSector: number | null;
};

type Seg = {
  start: number;
  end: number;
  line: number;
  side: 0 | 1;
  sector: number;
  offset: number;
};

type Box = { top: number; bottom: number; left: number; right: number };

type BspNode = {
  x: number;
  y: number;
  dx: number;
  dy: number;
  rightBox: Box;
  leftBox: Box;
  rightChild: number;
  leftChild: number;
};

type Subsector = { count: number; first: number };

type BspResult = {
  vertices: Point[];
  segs: Seg[];
  subsectors: Subsector[];
  nodes: BspNode[];
};

type Partition = {
  line: number;
  x: number;
  y: number;
  dx: number;
  dy: number;
  length: number;
};

const subsectorFlag = 0x8000;
const onLineTolerance = 0.75;
// A wall shorter than the tolerance can look like it lies on a nearby line,
// so a step that finds no partition tries again with exact sides.
const exactTolerance = 0.001;

// Positive is left of the partition, which is the engine's back child.
function distance(partition: Partition, point: Point) {
  return (
    (partition.dx * (point.y - partition.y) -
      partition.dy * (point.x - partition.x)) /
    partition.length
  );
}

function buildNodes(sourceVertices: Point[], lines: NodeLine[]): BspResult {
  const vertices = sourceVertices.map((vertex) => ({ ...vertex }));
  const vertexIndex = new Map(
    vertices.map((vertex, index) => [`${vertex.x},${vertex.y}`, index]),
  );
  const orderedSegs: Seg[] = [];
  const subsectors: Subsector[] = [];
  const nodes: BspNode[] = [];

  const vertexAt = (point: Point) => {
    const key = `${point.x},${point.y}`;
    const existing = vertexIndex.get(key);
    if (existing !== undefined) return existing;
    vertices.push(point);
    vertexIndex.set(key, vertices.length - 1);
    return vertices.length - 1;
  };

  const partitionOf = (seg: Seg): Partition => {
    const line = lines[seg.line];
    const origin = vertices[seg.side === 0 ? line.start : line.end];
    const target = vertices[seg.side === 0 ? line.end : line.start];
    const dx = target.x - origin.x;
    const dy = target.y - origin.y;
    return {
      line: seg.line,
      x: origin.x,
      y: origin.y,
      dx,
      dy,
      length: Math.hypot(dx, dy),
    };
  };

  const classify = (
    partition: Partition,
    seg: Seg,
    tolerance = onLineTolerance,
  ) => {
    const start = vertices[seg.start];
    const end = vertices[seg.end];
    const a = distance(partition, start);
    const b = distance(partition, end);
    // Split points are rounded, so pieces of a line can drift off it.
    if (
      seg.line === partition.line ||
      (Math.abs(a) <= tolerance && Math.abs(b) <= tolerance)
    ) {
      const dot =
        (end.x - start.x) * partition.dx + (end.y - start.y) * partition.dy;
      return { kind: dot >= 0 ? "right" : "left", a, b } as const;
    }
    if (a >= -tolerance && b >= -tolerance) {
      return { kind: "left", a, b } as const;
    }
    if (a <= tolerance && b <= tolerance) {
      return { kind: "right", a, b } as const;
    }
    return { kind: "split", a, b } as const;
  };

  const isConvex = (segs: Seg[]) =>
    segs.every((seg) => {
      const partition = partitionOf(seg);
      return segs.every((other) => classify(partition, other).kind === "right");
    });

  const isLeaf = (segs: Seg[]) =>
    segs.every((seg) => seg.sector === segs[0].sector) && isConvex(segs);

  // Rounded split points can lay one sector's wall over another's, leaving a
  // convex area with no width between them. The sector with the most wall
  // goes first, because the engine gives a subsector its first seg's sector.
  const leadingSector = (segs: Seg[]) => {
    const lengths = new Map<number, number>();
    for (const seg of segs) {
      const start = vertices[seg.start];
      const end = vertices[seg.end];
      lengths.set(
        seg.sector,
        (lengths.get(seg.sector) ?? 0) +
          Math.hypot(end.x - start.x, end.y - start.y),
      );
    }
    const [lead] = [...lengths].toSorted((a, b) => b[1] - a[1])[0];
    return segs.toSorted(
      (a, b) => Number(b.sector === lead) - Number(a.sector === lead),
    );
  };

  const choosePartition = (segs: Seg[], tolerance: number) => {
    let best: { partition: Partition; score: number } | null = null;
    const tried = new Set<string>();
    const count = segs.length;
    const startX = new Float64Array(count);
    const startY = new Float64Array(count);
    const endX = new Float64Array(count);
    const endY = new Float64Array(count);
    segs.forEach((seg, index) => {
      startX[index] = vertices[seg.start].x;
      startY[index] = vertices[seg.start].y;
      endX[index] = vertices[seg.end].x;
      endY[index] = vertices[seg.end].y;
    });
    for (const seg of segs) {
      const key = `${seg.line}:${seg.side}`;
      if (tried.has(key)) continue;
      tried.add(key);
      const partition = partitionOf(seg);
      const { x, y, dx, dy, length } = partition;
      let left = 0;
      let right = 0;
      let splits = 0;
      let index = 0;
      // Matches classify, without its allocations, for every pair of segs.
      for (; index < count; index++) {
        const a =
          (dx * (startY[index] - y) - dy * (startX[index] - x)) / length;
        const b = (dx * (endY[index] - y) - dy * (endX[index] - x)) / length;
        if (
          segs[index].line === partition.line ||
          (Math.abs(a) <= tolerance && Math.abs(b) <= tolerance)
        ) {
          const dot =
            (endX[index] - startX[index]) * dx +
            (endY[index] - startY[index]) * dy;
          if (dot >= 0) right += 1;
          else left += 1;
        } else if (a >= -tolerance && b >= -tolerance) left += 1;
        else if (a <= tolerance && b <= tolerance) right += 1;
        else splits += 1;
        // The lowest score the remaining segs could still bring it to.
        const bound =
          splits * 8 +
          Math.max(0, Math.abs(left - right) - (count - index - 1));
        if (best && bound >= best.score) break;
      }
      if (index < count) continue;
      if (left + splits === 0 || right + splits === 0) continue;
      const score = splits * 8 + Math.abs(left - right);
      if (!best || score < best.score) best = { partition, score };
    }
    return best?.partition ?? null;
  };

  const splitSegs = (partition: Partition, segs: Seg[], tolerance: number) => {
    const right: Seg[] = [];
    const left: Seg[] = [];
    for (const seg of segs) {
      const { kind, a, b } = classify(partition, seg, tolerance);
      if (kind === "right") {
        right.push(seg);
        continue;
      }
      if (kind === "left") {
        left.push(seg);
        continue;
      }
      const start = vertices[seg.start];
      const end = vertices[seg.end];
      const t = a / (a - b);
      const point = {
        x: Math.round(start.x + (end.x - start.x) * t),
        y: Math.round(start.y + (end.y - start.y) * t),
      };
      const middle = vertexAt(point);
      if (middle === seg.start || middle === seg.end) {
        const side = (Math.abs(a) > Math.abs(b) ? a : b) > 0 ? left : right;
        side.push(seg);
        continue;
      }
      const first = { ...seg, end: middle };
      const second = {
        ...seg,
        start: middle,
        offset: seg.offset + Math.hypot(point.x - start.x, point.y - start.y),
      };
      (a > 0 ? left : right).push(first);
      (b > 0 ? left : right).push(second);
    }
    return { right, left };
  };

  const boxOf = (segs: Seg[]): Box => {
    const points = segs.flatMap((seg) => [
      vertices[seg.start],
      vertices[seg.end],
    ]);
    return {
      top: Math.max(...points.map((point) => point.y)),
      bottom: Math.min(...points.map((point) => point.y)),
      left: Math.min(...points.map((point) => point.x)),
      right: Math.max(...points.map((point) => point.x)),
    };
  };

  const build = (segs: Seg[]): { child: number; box: Box } => {
    const box = boxOf(segs);
    const leaf = isLeaf(segs);
    let tolerance = onLineTolerance;
    let partition = leaf ? null : choosePartition(segs, tolerance);
    if (!leaf && !partition) {
      tolerance = exactTolerance;
      partition = choosePartition(segs, tolerance);
    }
    const split = partition && splitSegs(partition, segs, tolerance);
    if (!partition || !split || !split.right.length || !split.left.length) {
      if (!leaf && !isConvex(segs)) {
        throw new Error("The map could not be split into convex areas.");
      }
      subsectors.push({ count: segs.length, first: orderedSegs.length });
      orderedSegs.push(...(leaf ? segs : leadingSector(segs)));
      return { child: (subsectors.length - 1) | subsectorFlag, box };
    }
    const { right, left } = split;
    const rightChild = build(right);
    const leftChild = build(left);
    nodes.push({
      x: partition.x,
      y: partition.y,
      dx: partition.dx,
      dy: partition.dy,
      rightBox: rightChild.box,
      leftBox: leftChild.box,
      rightChild: rightChild.child,
      leftChild: leftChild.child,
    });
    return { child: nodes.length - 1, box };
  };

  const initial: Seg[] = lines.flatMap((line, index) => {
    const front: Seg = {
      start: line.start,
      end: line.end,
      line: index,
      side: 0,
      sector: line.frontSector,
      offset: 0,
    };
    if (line.backSector === null) return [front];
    const back: Seg = {
      start: line.end,
      end: line.start,
      line: index,
      side: 1,
      sector: line.backSector,
      offset: 0,
    };
    return [front, back];
  });
  build(initial);

  return { vertices, segs: orderedSegs, subsectors, nodes };
}

export {
  buildNodes,
  subsectorFlag,
  type BspNode,
  type BspResult,
  type Box,
  type NodeLine,
  type Seg,
  type Subsector,
};
