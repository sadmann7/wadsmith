import type { GameMap } from "@/lib/map/types";
import type { Picture, SceneAssets } from "@/lib/wad/assets";

import { defined } from "@/lib/defined";
import { shadeLevels } from "@/lib/wad/assets";

import type { SceneRenderer } from "./scene-renderer";

import { withMovers } from "./movers";
import {
  type Camera,
  cameraBasis,
  eyeOf,
  focalOf,
  type SceneOptions,
  skyHorizon,
  skyTurn,
  skyView,
  tiltOf,
} from "./render";
import {
  buildGhost,
  buildSceneMesh,
  meshFlags,
  type SceneMesh,
  vertexFloats,
} from "./scene-mesh";

const far = 65536;
const skyCapRows = 64;
const atlasSize = 4096;
const rectColumns = 256;
const markColumns = 1024;
const maxRows = 1440;
const maxWidth = 3840;
const noMovers: readonly string[] = [];

const marks = { selected: 1, hovered: 2, seeThrough: 4 } as const;

const shared = `
uniform sampler2D uAtlas;
uniform sampler2D uRects;
uniform vec3 uEye;
uniform vec2 uForward;
in vec3 vWorld;
in vec2 vTexel;
flat in int vSlot;
flat in float vId;
flat in int vLight;
flat in int vContrast;
flat in int vFlags;
int wrapped(float value, int size) {
  return int(mod(floor(value), float(size)));
}
vec4 rectOf(int slot) {
  return texelFetch(uRects, ivec2(slot % ${rectColumns}, slot / ${rectColumns}), 0);
}`;

interface Program {
  program: WebGLProgram;
  uniform: (name: string) => WebGLUniformLocation | null;
}

interface Uploaded {
  map: GameMap;
  assets: SceneAssets;
  sky: string | null;
  customSprites: ReadonlyMap<number, string | null> | undefined;
  mesh: SceneMesh;
  slotCount: number;
  skyCap: Float32Array;
}

interface AtlasRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export function createWebglRenderer(
  canvas: HTMLCanvasElement,
  width: number,
  height: number,
): SceneRenderer | null {
  // A canvas that took a WebGL context can't fall back to a 2D one, so
  // support is settled on a canvas of its own first.
  if (!getCanRunWebgl()) return null;
  const gl = contextOf(canvas);
  const programs = gl ? createPrograms(gl) : null;
  if (!gl || !programs) return null;
  const { world, span, composite } = programs;

  const meshBuffer = defined(gl.createBuffer());
  const spriteBuffer = defined(gl.createBuffer());
  const ghostBuffer = defined(gl.createBuffer());
  const meshArray = vertexArray(gl, meshBuffer);
  const spriteArray = vertexArray(gl, spriteBuffer);
  const ghostArray = vertexArray(gl, ghostBuffer);
  const screenArray = defined(gl.createVertexArray());

  const atlas = createTexture(gl);
  gl.texImage2D(
    gl.TEXTURE_2D,
    0,
    gl.RG8,
    atlasSize,
    atlasSize,
    0,
    gl.RG,
    gl.UNSIGNED_BYTE,
    null,
  );
  const rects = createTexture(gl);
  const shadesTexture = createTexture(gl);
  const marksTexture = createTexture(gl);

  const color = createTexture(gl);
  const pick = createTexture(gl);
  const extent = createTexture(gl);
  const sceneDepth = defined(gl.createRenderbuffer());
  const spanDepth = defined(gl.createRenderbuffer());
  const sceneFrame = defined(gl.createFramebuffer());
  const spanFrame = defined(gl.createFramebuffer());

  let size = { width, height };
  let uploaded: Uploaded | null = null;
  let shadesOf: Uint32Array | null = null;
  let atlasAssets: SceneAssets | null = null;
  const atlasRects = new Map<string, AtlasRect>();
  let shelf = { x: 0, y: 0, height: 0 };
  let lastSurfaces: string[] = [""];
  let isLost = false;
  const pixel = new Float32Array(4);

  canvas.addEventListener("webglcontextlost", (event) => {
    event.preventDefault();
    isLost = true;
  });

  const allocate = (frameSize: { width: number; height: number }) => {
    for (const [texture, format] of [
      [color, gl.RGBA8],
      [pick, gl.RGBA32F],
      [extent, gl.RGBA32F],
    ] as const) {
      gl.bindTexture(gl.TEXTURE_2D, texture);
      gl.texImage2D(
        gl.TEXTURE_2D,
        0,
        format,
        frameSize.width,
        frameSize.height,
        0,
        gl.RGBA,
        format === gl.RGBA8 ? gl.UNSIGNED_BYTE : gl.FLOAT,
        null,
      );
    }
    for (const buffer of [sceneDepth, spanDepth]) {
      gl.bindRenderbuffer(gl.RENDERBUFFER, buffer);
      gl.renderbufferStorage(
        gl.RENDERBUFFER,
        gl.DEPTH_COMPONENT32F,
        frameSize.width,
        frameSize.height,
      );
    }
    gl.bindFramebuffer(gl.FRAMEBUFFER, sceneFrame);
    gl.framebufferTexture2D(
      gl.FRAMEBUFFER,
      gl.COLOR_ATTACHMENT0,
      gl.TEXTURE_2D,
      color,
      0,
    );
    gl.framebufferTexture2D(
      gl.FRAMEBUFFER,
      gl.COLOR_ATTACHMENT1,
      gl.TEXTURE_2D,
      pick,
      0,
    );
    gl.framebufferRenderbuffer(
      gl.FRAMEBUFFER,
      gl.DEPTH_ATTACHMENT,
      gl.RENDERBUFFER,
      sceneDepth,
    );
    gl.bindFramebuffer(gl.FRAMEBUFFER, spanFrame);
    gl.framebufferTexture2D(
      gl.FRAMEBUFFER,
      gl.COLOR_ATTACHMENT0,
      gl.TEXTURE_2D,
      extent,
      0,
    );
    gl.framebufferRenderbuffer(
      gl.FRAMEBUFFER,
      gl.DEPTH_ATTACHMENT,
      gl.RENDERBUFFER,
      spanDepth,
    );
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  };
  allocate(size);

  const placePicture = (key: string, picture: Picture) => {
    const known = atlasRects.get(key);
    if (known) return known;
    const pictureWidth = Math.max(1, picture.width);
    const pictureHeight = Math.max(1, picture.height);
    if (shelf.x + pictureWidth > atlasSize) {
      shelf = { x: 0, y: shelf.y + shelf.height, height: 0 };
    }
    if (shelf.y + pictureHeight > atlasSize) return null;
    const rect = {
      x: shelf.x,
      y: shelf.y,
      width: pictureWidth,
      height: pictureHeight,
    };
    shelf.x += pictureWidth;
    shelf.height = Math.max(shelf.height, pictureHeight);
    const texels = new Uint8Array(pictureWidth * pictureHeight * 2);
    for (let column = 0; column < picture.width; column += 1) {
      for (let row = 0; row < picture.height; row += 1) {
        const source = column * picture.height + row;
        const target = (row * pictureWidth + column) * 2;
        texels[target] = picture.pixels[source];
        texels[target + 1] = picture.opaque[source] ? 255 : 0;
      }
    }
    gl.bindTexture(gl.TEXTURE_2D, atlas);
    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
    gl.texSubImage2D(
      gl.TEXTURE_2D,
      0,
      rect.x,
      rect.y,
      pictureWidth,
      pictureHeight,
      gl.RG,
      gl.UNSIGNED_BYTE,
      texels,
    );
    atlasRects.set(key, rect);
    return rect;
  };

  const resetAtlas = (assets: SceneAssets) => {
    atlasAssets = assets;
    atlasRects.clear();
    shelf = { x: 0, y: 0, height: 0 };
  };

  const uploadRects = (mesh: SceneMesh) => {
    // A full atlas starts over with only what this map shows.
    const fits = (from: number) =>
      mesh.pictures
        .slice(from)
        .every(({ key, picture }) => placePicture(key, picture));
    if (!fits(0) && atlasAssets) {
      resetAtlas(atlasAssets);
      fits(0);
    }
    const rows = Math.max(1, Math.ceil(mesh.pictures.length / rectColumns));
    const data = new Float32Array(rectColumns * rows * 4);
    mesh.pictures.forEach(({ key }, slot) => {
      const rect = atlasRects.get(key);
      if (!rect) return;
      data.set([rect.x, rect.y, rect.width, rect.height], slot * 4);
    });
    gl.bindTexture(gl.TEXTURE_2D, rects);
    gl.texImage2D(
      gl.TEXTURE_2D,
      0,
      gl.RGBA32F,
      rectColumns,
      rows,
      0,
      gl.RGBA,
      gl.FLOAT,
      data,
    );
  };

  const meshFor = (map: GameMap, options: SceneOptions) => {
    const sky = options.sky ?? null;
    const { assets, customSprites } = options;
    if (
      uploaded &&
      uploaded.map === map &&
      uploaded.assets === assets &&
      uploaded.sky === sky &&
      uploaded.customSprites === customSprites
    ) {
      return uploaded;
    }
    if (assets !== atlasAssets) resetAtlas(assets);
    if (assets.shades !== shadesOf) {
      shadesOf = assets.shades;
      gl.bindTexture(gl.TEXTURE_2D, shadesTexture);
      gl.texImage2D(
        gl.TEXTURE_2D,
        0,
        gl.RGBA8,
        256,
        assets.shades.length / 256,
        0,
        gl.RGBA,
        gl.UNSIGNED_BYTE,
        new Uint8Array(assets.shades.buffer),
      );
    }
    const mesh = buildSceneMesh(map, { assets, sky, customSprites });
    gl.bindBuffer(gl.ARRAY_BUFFER, meshBuffer);
    gl.bufferData(gl.ARRAY_BUFFER, mesh.vertices, gl.STATIC_DRAW);
    gl.bindBuffer(gl.ARRAY_BUFFER, spriteBuffer);
    gl.bufferData(gl.ARRAY_BUFFER, mesh.sprites, gl.STATIC_DRAW);
    uploadRects(mesh);
    uploaded = {
      map,
      assets,
      sky,
      customSprites,
      mesh,
      slotCount: mesh.pictures.length,
      skyCap: skyCapOf(mesh.heavens, assets.shades),
    };
    return uploaded;
  };

  const uploadMarks = (mesh: SceneMesh, options: SceneOptions) => {
    const rows = Math.max(1, Math.ceil(mesh.surfaces.length / markColumns));
    const data = new Uint8Array(markColumns * rows);
    for (const id of mesh.seeThrough) data[id] |= marks.seeThrough;
    const hovered = options.hovered ? mesh.ids.get(options.hovered) : undefined;
    if (hovered !== undefined) data[hovered] |= marks.hovered;
    for (const key of [options.selected, ...(options.picked ?? [])]) {
      const id = key ? mesh.ids.get(key) : undefined;
      if (id !== undefined) data[id] |= marks.selected;
    }
    gl.bindTexture(gl.TEXTURE_2D, marksTexture);
    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
    gl.texImage2D(
      gl.TEXTURE_2D,
      0,
      gl.R8,
      markColumns,
      rows,
      0,
      gl.RED,
      gl.UNSIGNED_BYTE,
      data,
    );
  };

  const bindWorld = (program: Program, map: GameMap, source: Camera) => {
    const { forward, right } = cameraBasis(source);
    const eye = eyeOf(map, source);
    // A corner exactly level with the eye has no depth, and SwiftShader then
    // smears the textures of the triangles it starts. Cameras stand on the
    // same grid as corners, so the eye stands a hair behind where it is.
    const camera = {
      ...source,
      x: source.x - forward.x * eyeBack,
      y: source.y - forward.y * eyeBack,
    };
    gl.useProgram(program.program);
    gl.uniformMatrix4fv(
      program.uniform("uView"),
      false,
      viewMatrix(camera, eye, size, focalOf(size.height)),
    );
    gl.uniform3f(program.uniform("uEye"), camera.x, camera.y, eye);
    gl.uniform2f(program.uniform("uForward"), forward.x, forward.y);
    gl.uniform2f(program.uniform("uRight"), right.x, right.y);
    bindTexture(gl, program, "uAtlas", 0, atlas);
    bindTexture(gl, program, "uRects", 1, rects);
  };

  return {
    kind: "webgl",
    tilts: true,
    get width() {
      return size.width;
    },
    get height() {
      return size.height;
    },
    get focal() {
      return focalOf(size.height);
    },
    sizeFor(clientWidth, clientHeight) {
      const ratio = globalThis.devicePixelRatio || 1;
      const rows = Math.max(
        1,
        Math.min(maxRows, Math.round(clientHeight * ratio)),
      );
      const wide = clientWidth / (clientHeight || 1);
      return {
        width: Math.max(1, Math.min(maxWidth, Math.round(rows * wide))),
        height: rows,
      };
    },
    resize(nextWidth, nextHeight) {
      if (nextWidth === size.width && nextHeight === size.height) return;
      size = { width: nextWidth, height: nextHeight };
      allocate(size);
    },
    render(sourceMap, camera, options, crosshair) {
      if (isLost) return;
      if (canvas.width !== size.width) canvas.width = size.width;
      if (canvas.height !== size.height) canvas.height = size.height;
      const map = withMovers(sourceMap, options.opened ?? noMovers);
      const current = meshFor(map, options);
      const { mesh } = current;
      lastSurfaces = mesh.surfaces;
      const ghost = options.ghost
        ? buildGhost(
            map,
            mesh,
            options.assets,
            options.ghost,
            options.customSprites,
          )
        : null;
      if (mesh.pictures.length !== current.slotCount) {
        current.slotCount = mesh.pictures.length;
        uploadRects(mesh);
      }
      uploadMarks(mesh, options);

      gl.bindFramebuffer(gl.FRAMEBUFFER, sceneFrame);
      gl.viewport(0, 0, size.width, size.height);
      gl.drawBuffers([gl.COLOR_ATTACHMENT0, gl.COLOR_ATTACHMENT1]);
      gl.clearBufferfv(gl.COLOR, 0, [0, 0, 0, 1]);
      gl.clearBufferfv(gl.COLOR, 1, [0, far, 0, 1]);
      gl.clearBufferfv(gl.DEPTH, 0, [1]);
      gl.enable(gl.DEPTH_TEST);
      gl.depthFunc(gl.LESS);
      gl.depthMask(true);
      gl.disable(gl.BLEND);

      bindWorld(world, map, camera);
      bindTexture(gl, world, "uShades", 2, shadesTexture);
      gl.uniform1i(world.uniform("uFullbright"), options.fullbright ? 1 : 0);
      gl.uniform4fv(world.uniform("uSkyCap"), current.skyCap);
      gl.bindVertexArray(meshArray);
      gl.enable(gl.CULL_FACE);
      gl.drawArrays(gl.TRIANGLES, 0, mesh.flatStart);
      gl.drawArrays(gl.TRIANGLES, mesh.maskedStart, mesh.maskedCount);
      gl.disable(gl.CULL_FACE);
      gl.drawArrays(
        gl.TRIANGLES,
        mesh.flatStart,
        mesh.maskedStart - mesh.flatStart,
      );
      if (options.things !== false && mesh.sprites.length > 0) {
        gl.bindVertexArray(spriteArray);
        gl.drawArrays(gl.TRIANGLES, 0, mesh.sprites.length / vertexFloats);
      }
      if (ghost) {
        gl.bindBuffer(gl.ARRAY_BUFFER, ghostBuffer);
        gl.bufferData(gl.ARRAY_BUFFER, ghost, gl.DYNAMIC_DRAW);
        gl.bindVertexArray(ghostArray);
        gl.drawBuffers([gl.COLOR_ATTACHMENT0, gl.NONE]);
        gl.depthMask(false);
        gl.enable(gl.BLEND);
        gl.blendColor(0, 0, 0, 0.5);
        gl.blendFunc(gl.CONSTANT_ALPHA, gl.ONE_MINUS_CONSTANT_ALPHA);
        gl.drawArrays(gl.TRIANGLES, 0, ghost.length / vertexFloats);
        gl.disable(gl.BLEND);
        gl.depthMask(true);
      }

      gl.bindFramebuffer(gl.FRAMEBUFFER, spanFrame);
      gl.drawBuffers([gl.COLOR_ATTACHMENT0]);
      gl.clearBufferfv(gl.COLOR, 0, [0, far, 0, 1]);
      gl.clearBufferfv(gl.DEPTH, 0, [1]);
      if (mesh.maskedCount > 0) {
        bindWorld(span, map, camera);
        bindTexture(gl, span, "uPick", 2, pick);
        gl.bindVertexArray(meshArray);
        gl.enable(gl.CULL_FACE);
        gl.drawArrays(gl.TRIANGLES, mesh.maskedStart, mesh.maskedCount);
        gl.disable(gl.CULL_FACE);
      }

      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      gl.disable(gl.DEPTH_TEST);
      gl.useProgram(composite.program);
      bindTexture(gl, composite, "uColor", 0, color);
      bindTexture(gl, composite, "uPick", 1, pick);
      bindTexture(gl, composite, "uExtent", 2, extent);
      bindTexture(gl, composite, "uMarks", 3, marksTexture);
      gl.uniform2i(composite.uniform("uSize"), size.width, size.height);
      const scale = Math.max(1, Math.round(size.height / 400));
      gl.uniform1i(
        composite.uniform("uOutline"),
        Math.min(4, Math.max(2, 2 * scale)),
      );
      gl.uniform1i(composite.uniform("uCrosshair"), crosshair ? 1 : 0);
      gl.uniform4fv(
        composite.uniform("uCrosshairColor"),
        cssColor(crosshair ?? "#fff"),
      );
      gl.uniform1i(composite.uniform("uCrosshairScale"), scale);
      gl.bindVertexArray(screenArray);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
      gl.bindVertexArray(null);
    },
    surfaceAt(x, y) {
      if (isLost) return { key: null, distance: Infinity };
      gl.bindFramebuffer(gl.READ_FRAMEBUFFER, sceneFrame);
      gl.readBuffer(gl.COLOR_ATTACHMENT1);
      gl.readPixels(x, size.height - 1 - y, 1, 1, gl.RGBA, gl.FLOAT, pixel);
      gl.bindFramebuffer(gl.READ_FRAMEBUFFER, null);
      return {
        key: lastSurfaces[Math.round(pixel[0])] || null,
        distance: pixel[1],
      };
    },
    surfaceCounts() {
      const counts = new Map<string, number>();
      if (isLost) return counts;
      const data = new Float32Array(size.width * size.height * 4);
      gl.bindFramebuffer(gl.READ_FRAMEBUFFER, sceneFrame);
      gl.readBuffer(gl.COLOR_ATTACHMENT1);
      gl.readPixels(0, 0, size.width, size.height, gl.RGBA, gl.FLOAT, data);
      gl.bindFramebuffer(gl.READ_FRAMEBUFFER, null);
      for (let index = 0; index < data.length; index += 4) {
        const key = lastSurfaces[Math.round(data[index])];
        if (key) counts.set(key, (counts.get(key) ?? 0) + 1);
      }
      return counts;
    },
    destroy() {
      for (const buffer of [meshBuffer, spriteBuffer, ghostBuffer]) {
        gl.deleteBuffer(buffer);
      }
      for (const array of [meshArray, spriteArray, ghostArray, screenArray]) {
        gl.deleteVertexArray(array);
      }
      for (const texture of [
        atlas,
        rects,
        shadesTexture,
        marksTexture,
        color,
        pick,
        extent,
      ]) {
        gl.deleteTexture(texture);
      }
      gl.deleteRenderbuffer(sceneDepth);
      gl.deleteRenderbuffer(spanDepth);
      gl.deleteFramebuffer(sceneFrame);
      gl.deleteFramebuffer(spanFrame);
      for (const { program } of [world, span, composite]) {
        gl.deleteProgram(program);
      }
    },
  };
}

const eyeBack = 0.01;

// The average color of a sky's top row.
function skyCapOf(heavens: Picture | null, shades: Uint32Array) {
  const sum = [0, 0, 0];
  const width = heavens?.width ?? 0;
  for (let column = 0; heavens && column < width; column += 1) {
    const color = shades[heavens.pixels[column * heavens.height]];
    sum[0] += color & 255;
    sum[1] += (color >>> 8) & 255;
    sum[2] += (color >>> 16) & 255;
  }
  const scale = 1 / 255 / Math.max(1, width);
  return Float32Array.of(sum[0] * scale, sum[1] * scale, sum[2] * scale, 1);
}

let canRunWebgl: boolean | undefined;

function getCanRunWebgl() {
  if (canRunWebgl === undefined) {
    const gl = contextOf(document.createElement("canvas"));
    canRunWebgl = Boolean(gl && createPrograms(gl));
    gl?.getExtension("WEBGL_lose_context")?.loseContext();
  }
  return canRunWebgl;
}

function contextOf(canvas: HTMLCanvasElement) {
  const gl = canvas.getContext("webgl2", {
    antialias: false,
    depth: false,
    alpha: false,
  });
  return gl?.getExtension("EXT_color_buffer_float") ? gl : null;
}

const worldVertex = `#version 300 es
layout(location = 0) in vec3 aPosition;
layout(location = 1) in vec2 aTexel;
layout(location = 2) in float aSlot;
layout(location = 3) in float aId;
layout(location = 4) in float aLight;
layout(location = 5) in float aContrast;
layout(location = 6) in float aFlags;
layout(location = 7) in vec2 aOffset;
uniform mat4 uView;
uniform vec3 uEye;
uniform vec2 uForward;
uniform vec2 uRight;
out vec3 vWorld;
out vec2 vTexel;
flat out int vSlot;
flat out float vId;
flat out int vLight;
flat out int vContrast;
flat out int vFlags;
void main() {
  vec3 world = aPosition;
  vFlags = int(aFlags);
  if ((vFlags & ${meshFlags.sprite}) != 0) {
    if (dot(aPosition.xy - uEye.xy, uForward) <= 8.0) {
      gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
      return;
    }
    world.xy += uRight * aOffset.x;
    world.z += aOffset.y;
  }
  vWorld = world;
  vTexel = aTexel;
  vSlot = int(aSlot);
  vId = aId;
  vLight = int(aLight);
  vContrast = int(aContrast);
  gl_Position = uView * vec4(world, 1.0);
}`;

const worldFragment = `#version 300 es
precision highp float;
precision highp int;
precision highp sampler2D;
${shared}
uniform sampler2D uShades;
uniform bool uFullbright;
uniform vec4 uSkyCap;
layout(location = 0) out vec4 oColor;
layout(location = 1) out vec4 oPick;
int lightStart(int light, int contrast) {
  int band = clamp((light >> 4) + contrast, 0, 15);
  return (15 - band) * 4;
}
void main() {
  vec4 rect = rectOf(vSlot);
  ivec2 origin = ivec2(rect.xy);
  int width = int(rect.z);
  int height = int(rect.w);
  vec3 toward = vWorld - uEye;
  float ahead = dot(toward.xy, uForward);
  int column;
  int row;
  int level = 0;
  float capped = 0.0;
  if ((vFlags & ${meshFlags.sky}) != 0) {
    float turn = atan(-toward.y, toward.x) / 6.28318530718;
    if (turn < 0.0) turn += 1.0;
    column = wrapped(turn * ${skyTurn.toFixed(1)}, width);
    float rise = toward.z / max(length(toward.xy), 0.001);
    float down = ${skyHorizon.toFixed(1)} - rise * ${(skyView / 2).toFixed(1)};
    // Above its top row the sky fades into one color, which a view that
    // looks straight up would otherwise see wrapped into rings.
    capped = clamp(-down / ${skyCapRows.toFixed(1)}, 0.0, 1.0);
    row = down < 0.0 ? 0 : wrapped(down, height);
  } else {
    bool cut = (vFlags & ${meshFlags.masked | meshFlags.sprite}) != 0;
    float down = floor(vTexel.y);
    if (cut && (down < 0.0 || down >= float(height))) discard;
    if ((vFlags & ${meshFlags.sprite}) != 0) {
      column = clamp(int(floor(vTexel.x)), 0, width - 1);
      row = clamp(int(down), 0, height - 1);
    } else {
      column = wrapped(vTexel.x, width);
      row = cut ? int(down) : wrapped(vTexel.y, height);
    }
    float distance = max(ahead, 0.001);
    if ((vFlags & ${meshFlags.flat}) != 0) {
      int band = min(127, int(floor(distance / 16.0)));
      level = lightStart(vLight, 0) - ((160 / (band + 1)) >> 1);
    } else {
      int scale = min(47, int(floor(2560.0 / distance)));
      level = lightStart(vLight, vContrast) - (scale >> 1);
    }
    level = uFullbright ? 0 : clamp(level, 0, ${shadeLevels - 1});
  }
  vec2 texel = texelFetch(uAtlas, origin + ivec2(column, row), 0).rg;
  if ((vFlags & ${meshFlags.masked | meshFlags.sprite}) != 0 && texel.g < 0.5) {
    discard;
  }
  int index = int(texel.r * 255.0 + 0.5);
  oColor = mix(texelFetch(uShades, ivec2(index, level), 0), uSkyCap, capped);
  oPick = vec4(vId, ahead, 0.0, 1.0);
}`;

const spanFragment = `#version 300 es
precision highp float;
precision highp int;
precision highp sampler2D;
${shared}
uniform sampler2D uPick;
layout(location = 0) out vec4 oExtent;
void main() {
  float ahead = dot(vWorld.xy - uEye.xy, uForward);
  float scene = texelFetch(uPick, ivec2(gl_FragCoord.xy), 0).g;
  if (scene < ahead - 0.5) discard;
  oExtent = vec4(vId, ahead, 0.0, 1.0);
}`;

const screenVertex = `#version 300 es
void main() {
  vec2 corner = vec2(float((gl_VertexID << 1) & 2), float(gl_VertexID & 2));
  gl_Position = vec4(corner * 2.0 - 1.0, 0.0, 1.0);
}`;

const compositeFragment = `#version 300 es
precision highp float;
precision highp int;
precision highp sampler2D;
uniform sampler2D uColor;
uniform sampler2D uPick;
uniform sampler2D uExtent;
uniform sampler2D uMarks;
uniform ivec2 uSize;
uniform int uOutline;
uniform bool uCrosshair;
uniform vec4 uCrosshairColor;
uniform int uCrosshairScale;
out vec4 oColor;
int markOf(float id) {
  int at = int(id + 0.5);
  if (at <= 0) return 0;
  return int(texelFetch(uMarks, ivec2(at % ${markColumns}, at / ${markColumns}), 0).r * 255.0 + 0.5);
}
void main() {
  ivec2 at = ivec2(gl_FragCoord.xy);
  vec4 color = texelFetch(uColor, at, 0);
  vec4 shown = texelFetch(uPick, at, 0);
  vec4 span = texelFetch(uExtent, at, 0);
  int shownMark = markOf(shown.r);
  int spanMark = markOf(span.r);
  bool spanCan = (spanMark & ${marks.selected | marks.hovered}) != 0;
  bool shownCan = (shownMark & ${marks.selected | marks.hovered}) != 0 &&
    (shownMark & ${marks.seeThrough}) == 0;
  if (spanCan || shownCan) {
    bool spanEdge = false;
    bool shownEdge = false;
    for (int step = 1; step <= 4; step += 1) {
      if (step > uOutline) break;
      for (int side = 0; side < 4; side += 1) {
        ivec2 way = side == 0 ? ivec2(-1, 0) : side == 1 ? ivec2(1, 0) : side == 2 ? ivec2(0, -1) : ivec2(0, 1);
        ivec2 next = at + way * step;
        if (next.x < 0 || next.y < 0 || next.x >= uSize.x || next.y >= uSize.y) continue;
        if (spanCan && texelFetch(uExtent, next, 0).r != span.r) spanEdge = true;
        if (shownCan) {
          vec4 beside = texelFetch(uPick, next, 0);
          bool veiled = (markOf(beside.r) & ${marks.seeThrough}) != 0 && beside.g < shown.g;
          if (beside.r != shown.r && !veiled) shownEdge = true;
        }
      }
    }
    bool isMarked = (spanEdge && (spanMark & ${marks.selected}) != 0) ||
      (shownEdge && (shownMark & ${marks.selected}) != 0);
    if (isMarked) color = vec4(1.0, 106.0 / 255.0, 43.0 / 255.0, 1.0);
    else if (spanEdge || shownEdge) color = vec4(1.0);
  }
  if (uCrosshair) {
    ivec2 middle = ivec2(uSize.x / 2, uSize.y - 1 - uSize.y / 2);
    ivec2 away = at - middle;
    int arm = 6 * uCrosshairScale;
    bool across = abs(away.x) <= arm && away.y > -uCrosshairScale && away.y <= 0;
    bool upright = abs(away.y) <= arm && away.x >= 0 && away.x < uCrosshairScale;
    if (across || upright) color = uCrosshairColor;
  }
  oColor = color;
}`;

function createPrograms(gl: WebGL2RenderingContext) {
  const world = createProgram(gl, worldVertex, worldFragment);
  const span = createProgram(gl, worldVertex, spanFragment);
  const composite = createProgram(gl, screenVertex, compositeFragment);
  return world && span && composite ? { world, span, composite } : null;
}

const near = 0.5;

// World to clip space for a camera that turns about its eye and tilts up by
// its pitch, with the focal length the column renderer uses.
function viewMatrix(
  camera: Camera,
  eye: number,
  size: { width: number; height: number },
  focal: number,
) {
  const { forward, right } = cameraBasis(camera);
  const tilt = tiltOf(camera);
  const cos = Math.cos(tilt);
  const sin = Math.sin(tilt);
  const ahead = [forward.x * cos, forward.y * cos, sin];
  const up = [-forward.x * sin, -forward.y * sin, cos];
  const side = [right.x, right.y, 0];
  const at = [camera.x, camera.y, eye];
  const dot = (axis: number[]) =>
    axis[0] * at[0] + axis[1] * at[1] + axis[2] * at[2];
  const scaleX = (2 * focal) / size.width;
  const scaleY = (2 * focal) / size.height;
  const depthScale = (far + near) / (far - near);
  const depthShift = (-2 * far * near) / (far - near);
  const rows = [
    [...side.map((value) => value * scaleX), -dot(side) * scaleX],
    [...up.map((value) => value * scaleY), -dot(up) * scaleY],
    [
      ...ahead.map((value) => value * depthScale),
      -dot(ahead) * depthScale + depthShift,
    ],
    [...ahead, -dot(ahead)],
  ];
  const matrix = new Float32Array(16);
  for (let row = 0; row < 4; row += 1) {
    for (let column = 0; column < 4; column += 1) {
      matrix[column * 4 + row] = rows[row][column];
    }
  }
  return matrix;
}

function createProgram(
  gl: WebGL2RenderingContext,
  vertex: string,
  fragment: string,
): Program | null {
  const program = gl.createProgram();
  const compile = (type: number, source: string) => {
    const shader = gl.createShader(type);
    if (!shader) return null;
    gl.shaderSource(shader, source);
    gl.compileShader(shader);
    if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
      console.warn(gl.getShaderInfoLog(shader));
      return null;
    }
    return shader;
  };
  const vertexShader = compile(gl.VERTEX_SHADER, vertex);
  const fragmentShader = compile(gl.FRAGMENT_SHADER, fragment);
  if (!program || !vertexShader || !fragmentShader) return null;
  gl.attachShader(program, vertexShader);
  gl.attachShader(program, fragmentShader);
  gl.linkProgram(program);
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
    console.warn(gl.getProgramInfoLog(program));
    return null;
  }
  const locations = new Map<string, WebGLUniformLocation | null>();
  return {
    program,
    uniform(name) {
      if (!locations.has(name)) {
        locations.set(name, gl.getUniformLocation(program, name));
      }
      return locations.get(name) ?? null;
    },
  };
}

function vertexArray(gl: WebGL2RenderingContext, buffer: WebGLBuffer) {
  const array = defined(gl.createVertexArray());
  gl.bindVertexArray(array);
  gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
  const stride = vertexFloats * 4;
  const layout = [3, 2, 1, 1, 1, 1, 1, 2];
  let offset = 0;
  layout.forEach((count, location) => {
    gl.enableVertexAttribArray(location);
    gl.vertexAttribPointer(location, count, gl.FLOAT, false, stride, offset);
    offset += count * 4;
  });
  gl.bindVertexArray(null);
  return array;
}

function createTexture(gl: WebGL2RenderingContext) {
  const texture = defined(gl.createTexture());
  gl.bindTexture(gl.TEXTURE_2D, texture);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  return texture;
}

function bindTexture(
  gl: WebGL2RenderingContext,
  program: Program,
  name: string,
  unit: number,
  texture: WebGLTexture,
) {
  gl.activeTexture(gl.TEXTURE0 + unit);
  gl.bindTexture(gl.TEXTURE_2D, texture);
  gl.uniform1i(program.uniform(name), unit);
}

const colorCache = new Map<string, [number, number, number, number]>();

// The crosshair takes a CSS color, which a 1×1 canvas turns into channels.
function cssColor(value: string) {
  const known = colorCache.get(value);
  if (known) return known;
  const probe = document.createElement("canvas").getContext("2d");
  let channels: [number, number, number, number] = [1, 1, 1, 1];
  if (probe) {
    probe.fillStyle = value;
    probe.fillRect(0, 0, 1, 1);
    const [red, green, blue] = probe.getImageData(0, 0, 1, 1).data;
    channels = [red / 255, green / 255, blue / 255, 1];
  }
  colorCache.set(value, channels);
  return channels;
}
