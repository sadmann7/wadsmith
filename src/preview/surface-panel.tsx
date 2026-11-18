import { Radio, RadioGroup } from "@ui-sdk/react/radio";
import { useEffect, useRef } from "react";

import type { SurfaceInfo } from "../map/surfaces";
import type { Picture, SceneAssets } from "../wad/assets";

const swatchSize = 48;

function TextureSwatch({
  name,
  picture,
  assets,
  className = "swatch-image",
}: {
  name: string;
  picture: Picture;
  assets: SceneAssets;
  className?: string;
}) {
  const ref = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const context = ref.current?.getContext("2d");
    if (!context) return;
    const image = context.createImageData(swatchSize, swatchSize);
    const colors = new Uint32Array(image.data.buffer);
    const step = Math.max(picture.width, picture.height) / swatchSize;
    const left = (swatchSize - picture.width / step) / 2;
    const top = (swatchSize - picture.height / step) / 2;
    for (let x = 0; x < swatchSize; x += 1) {
      for (let y = 0; y < swatchSize; y += 1) {
        const column = Math.floor((x - left) * step);
        const row = Math.floor((y - top) * step);
        if (column < 0 || column >= picture.width) continue;
        if (row < 0 || row >= picture.height) continue;
        colors[y * swatchSize + x] =
          assets.shades[picture.pixels[column * picture.height + row]];
      }
    }
    context.putImageData(image, 0, 0);
  }, [assets, picture]);

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

function SurfacePanel({
  info,
  assets,
  onPaint,
}: {
  info: SurfaceInfo;
  assets: SceneAssets;
  onPaint: (texture: string, wholeRoom: boolean) => void;
}) {
  const usesFlats = info.paints === "floor" || info.paints === "ceiling";
  return (
    <div className="stack">
      <p className="thing-name">{info.label}</p>
      {info.height !== null ? (
        <p className="muted">
          Height {info.height}. Drag it in the view, or press Page Up or Page
          Down.
        </p>
      ) : null}
      {info.paints && info.texture ? (
        <>
          <RadioGroup
            aria-label="Texture"
            className="swatches"
            value={info.texture}
            onValueChange={(texture) => onPaint(texture as string, false)}
          >
            {info.textures.map((name) => (
              <label key={name} className="swatch">
                <Radio value={name} className="swatch-radio" />
                <TextureSwatch
                  name={name}
                  assets={assets}
                  picture={usesFlats ? assets.flat(name) : assets.texture(name)}
                />
                <span>{name}</span>
              </label>
            ))}
          </RadioGroup>
          {info.paints === "wall" ? (
            <button
              type="button"
              className="button"
              onClick={() => onPaint(info.texture!, true)}
            >
              Use on every wall in this room
            </button>
          ) : null}
        </>
      ) : null}
    </div>
  );
}

export { SurfacePanel, TextureSwatch };
