import { Radio, RadioGroup } from "@ui-sdk/react/radio";
import * as React from "react";

import type { SurfaceInfo } from "@/lib/map/surfaces";

import { Button } from "@/components/ui/button";
import {
  gameWallShade,
  type Picture,
  type SceneAssets,
} from "@/lib/wad/assets";

const swatchSize = 48;
const tileSize = 64;

interface TextureSwatchProps {
  name: string;
  picture: Picture;
  assets: SceneAssets;
  light?: number;
  whole?: boolean;
  className?: string;
}

export function TextureSwatch({
  name,
  picture,
  assets,
  light = 255,
  whole = false,
  className = "swatch-image",
}: TextureSwatchProps) {
  const ref = React.useRef<HTMLCanvasElement>(null);

  React.useEffect(() => {
    const context = ref.current?.getContext("2d");
    if (!context) return;
    const image = context.createImageData(swatchSize, swatchSize);
    const colors = new Uint32Array(image.data.buffer);
    const { width, height, pixels } = picture;
    const shade = gameWallShade(light) * 256;
    // Walls tile at one scale in the game, while doors and switches are single objects.
    const step = (whole ? Math.max(width, height) : tileSize) / swatchSize;
    const left = whole ? (swatchSize - width / step) / 2 : 0;
    const top = whole ? (swatchSize - height / step) / 2 : 0;
    for (let x = 0; x < swatchSize; x += 1) {
      for (let y = 0; y < swatchSize; y += 1) {
        const across = Math.floor((x - left) * step);
        const down = Math.floor((y - top) * step);
        if (whole && (across < 0 || across >= width)) continue;
        if (whole && (down < 0 || down >= height)) continue;
        const color = pixels[(across % width) * height + (down % height)];
        colors[y * swatchSize + x] = assets.shades[shade + color];
      }
    }
    context.putImageData(image, 0, 0);
  }, [assets, light, picture, whole]);

  return (
    <canvas
      ref={ref}
      className={className}
      width={swatchSize}
      height={swatchSize}
      aria-hidden="true"
      title={name}
    />
  );
}

interface SurfacePanelProps {
  info: SurfaceInfo;
  assets: SceneAssets;
  onPaint: (texture: string, wholeRoom: boolean) => void;
}

export function SurfacePanel({ info, assets, onPaint }: SurfacePanelProps) {
  const usesFlats = info.paints === "floor" || info.paints === "ceiling";
  const { texture } = info;
  return (
    <div className="flex flex-col gap-2.5">
      <p className="thing-name">{info.label}</p>
      {info.height !== null ? (
        <p className="text-muted-foreground">
          Height {info.height}. Drag it in the view, or press Page Up or Page
          Down.
        </p>
      ) : null}
      {info.paints && texture ? (
        <>
          <RadioGroup
            aria-label="Texture"
            className="swatches"
            value={texture}
            onValueChange={(texture) => onPaint(texture as string, false)}
          >
            {info.textures.map((name) => (
              <label key={name} className="swatch">
                <Radio value={name} className="swatch-radio" />
                <TextureSwatch
                  name={name}
                  assets={assets}
                  picture={usesFlats ? assets.flat(name) : assets.texture(name)}
                  light={info.sector?.light}
                  whole={info.paints === "door" || info.paints === "switch"}
                />
                <span>{name}</span>
              </label>
            ))}
          </RadioGroup>
          {info.paints === "wall" || info.paints === "door" ? (
            <Button onClick={() => onPaint(texture, true)}>
              {info.paints === "door"
                ? "Use on the whole door"
                : "Use on every wall in this room"}
            </Button>
          ) : null}
        </>
      ) : null}
    </div>
  );
}
