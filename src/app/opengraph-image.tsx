import { readFile } from "node:fs/promises";
import { join } from "node:path";

import { ImageResponse } from "next/og";

import { starterMap } from "@/lib/map/starter-map";

export const alt = "Wadsmith, a Doom map editor for the browser";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

function fontFile(weight: number) {
  return readFile(
    join(
      process.cwd(),
      `node_modules/@fontsource/ibm-plex-sans-condensed/files/ibm-plex-sans-condensed-latin-${weight}-normal.woff`,
    ),
  );
}

function mapPolygons() {
  const points = Object.values(starterMap.vertices);
  const left = Math.min(...points.map((point) => point.x));
  const top = Math.min(...points.map((point) => point.y));
  const width = Math.max(...points.map((point) => point.x)) - left;
  const height = Math.max(...points.map((point) => point.y)) - top;
  const scale = Math.min(500 / width, 400 / height);
  return {
    width: width * scale,
    height: height * scale,
    sectors: starterMap.sectors.map((sector) => ({
      id: sector.id,
      door: Boolean(sector.door),
      points: sector.vertices
        .map((id) => {
          const point = starterMap.vertices[id];
          return `${(point.x - left) * scale},${(point.y - top) * scale}`;
        })
        .join(" "),
    })),
  };
}

export default async function OpenGraphImage() {
  const [regular, bold] = await Promise.all([fontFile(400), fontFile(700)]);
  const map = mapPolygons();

  return new ImageResponse(
    <div
      style={{
        display: "flex",
        width: "100%",
        height: "100%",
        alignItems: "center",
        justifyContent: "space-between",
        padding: "72px",
        background: "#0e0d0c",
        color: "#efe9df",
        fontFamily: "IBM Plex Sans Condensed",
      }}
    >
      <div style={{ display: "flex", flexDirection: "column", width: 500 }}>
        <div
          style={{
            color: "#ff6a2b",
            fontSize: 38,
            fontWeight: 700,
            letterSpacing: 4,
          }}
        >
          WADSMITH
        </div>
        <div
          style={{
            marginTop: 28,
            fontSize: 72,
            fontWeight: 700,
            lineHeight: 1.02,
          }}
        >
          Build Doom maps in your browser
        </div>
        <div style={{ marginTop: 24, color: "#a59d90", fontSize: 32 }}>
          Draw rooms, wire doors and play them in the real engine.
        </div>
      </div>
      <svg width={map.width} height={map.height}>
        {map.sectors.map((sector) => (
          <polygon
            key={sector.id}
            points={sector.points}
            fill={sector.door ? "#5a4316" : "#2a2723"}
            stroke="#c9c0b1"
            strokeWidth="3"
          />
        ))}
      </svg>
    </div>,
    {
      ...size,
      fonts: [
        {
          name: "IBM Plex Sans Condensed",
          data: regular,
          weight: 400,
          style: "normal",
        },
        {
          name: "IBM Plex Sans Condensed",
          data: bold,
          weight: 700,
          style: "normal",
        },
      ],
    },
  );
}
