import { useEffect, useImperativeHandle, useRef, type Ref } from "react";

import { sectorAt } from "../map/geometry";
import type { GameMap } from "../map/types";
import { renderPreview, startCamera, type Camera } from "./render";

const width = 320;
const height = 200;
const moveSpeed = 260;
const turnSpeed = 120;

type MapPreviewHandle = { show: (map: GameMap) => void };

function MapPreview({
  map,
  ref,
}: {
  map: GameMap;
  ref?: Ref<MapPreviewHandle>;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const shownMap = useRef(map);
  const camera = useRef<Camera>(startCamera(map));
  const walked = useRef(false);
  const held = useRef(new Set<string>());
  const frame = useRef(0);

  const draw = () => {
    const context = canvasRef.current?.getContext("2d");
    if (!context) return;
    const image = context.createImageData(width, height);
    renderPreview(image.data, width, height, shownMap.current, camera.current);
    context.putImageData(image, 0, 0);
  };

  const show = (next: GameMap) => {
    shownMap.current = next;
    if (!walked.current || !sectorAt(next, camera.current)) {
      walked.current = false;
      camera.current = startCamera(next);
    }
    draw();
  };

  useImperativeHandle(ref, () => ({ show }));

  useEffect(() => {
    show(map);
  });

  useEffect(() => () => cancelAnimationFrame(frame.current), []);

  const animate = (previous: number) => {
    frame.current = requestAnimationFrame((now) => {
      const keys = held.current;
      if (keys.size === 0) {
        frame.current = 0;
        return;
      }
      const seconds = Math.min(0.05, (now - previous) / 1000);
      const view = camera.current;
      const pressed = (...codes: string[]) =>
        codes.some((code) => keys.has(code));
      const turn = Number(pressed("ArrowLeft")) - Number(pressed("ArrowRight"));
      const advance =
        Number(pressed("ArrowUp", "KeyW")) -
        Number(pressed("ArrowDown", "KeyS"));
      const strafe = Number(pressed("KeyD")) - Number(pressed("KeyA"));
      const angle = view.angle + turn * turnSpeed * seconds;
      const radians = (angle * Math.PI) / 180;
      const forward = { x: Math.cos(radians), y: -Math.sin(radians) };
      const distance = moveSpeed * seconds;
      const next = {
        x: view.x + (forward.x * advance - forward.y * strafe) * distance,
        y: view.y + (forward.y * advance + forward.x * strafe) * distance,
      };
      const inside = sectorAt(shownMap.current, next);
      camera.current = { ...(inside ? next : view), angle };
      walked.current = true;
      draw();
      animate(now);
    });
  };

  return (
    <canvas
      ref={canvasRef}
      className="screen"
      width={width}
      height={height}
      tabIndex={0}
      aria-label="3D preview. Use the arrow keys or W, A, S and D to walk."
      onBlur={() => held.current.clear()}
      onKeyDown={(event) => {
        if (!/^(Arrow|Key[WASD]$)/.test(event.code)) return;
        event.preventDefault();
        held.current.add(event.code);
        if (!frame.current) animate(performance.now());
      }}
      onKeyUp={(event) => held.current.delete(event.code)}
    />
  );
}

export { MapPreview, type MapPreviewHandle };
