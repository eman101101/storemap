/**
 * Featherweight 3D scene renderer for store maps — no dependencies.
 *
 * World axes match the 2D map: x/y across the floor (y down), z up, meters.
 * Perspective projection + painter's algorithm over extruded map elements,
 * drawn into a plain Canvas2D context. Cheap enough for low-end browsers:
 * one draw pass per frame, no shaders, no scene graph.
 */
import type { Floor, MapElement, RectGeom, PointGeom } from '../types';
import { polyPoints, polyMidpoint, rectCorners, type WorldPt } from './geometry';
import { TYPE_COLOR, TYPE_STROKE } from './mapColors';

export interface V3 {
  x: number;
  y: number;
  z: number;
}

export interface Camera3D {
  yaw: number; // rotation of the scene around z (rad)
  pitch: number; // 0 = eye level, π/2 = straight down (rad)
  dist: number; // eye distance to target (m)
  tx: number; // look-at target
  ty: number;
  tz: number;
  fov?: number; // vertical fov (rad)
}

export const DEFAULT_FOV = 50 * (Math.PI / 180);

/** Height each element type is extruded to, in meters. */
const TYPE_HEIGHT: Record<string, number> = {
  wall: 3.2,
  shelf: 1.5,
  zone: 0.06,
  aisle: 0.04,
};

export interface Face {
  pts: V3[];
  fill?: string; // pre-shaded css color
  stroke?: string;
  lw?: number; // screen px
  alpha?: number;
  layer?: number; // 0 floor · 0.25 grid · 0.5 decals · 1 route · 2 solid · 3 overlay
  line?: boolean; // draw as polyline instead of polygon
}

export const NEAR = 0.25; // near plane, meters

export interface CamPt {
  x1: number;
  up: number;
  depth: number;
}

/** World point → camera space (before the perspective divide). */
export function toCamera(cam: Camera3D, p: V3): CamPt {
  const cosY = Math.cos(cam.yaw);
  const sinY = Math.sin(cam.yaw);
  const dx = p.x - cam.tx;
  const dy = p.y - cam.ty;
  const dz = p.z - cam.tz;
  const x1 = dx * cosY - dy * sinY;
  const y1 = dx * sinY + dy * cosY;
  const cosP = Math.cos(cam.pitch);
  const sinP = Math.sin(cam.pitch);
  return { x1, up: dz * cosP - y1 * sinP, depth: cam.dist - y1 * cosP - dz * sinP };
}

function camToScreen(c: CamPt, w: number, h: number, fov: number): { x: number; y: number } {
  const f = h / 2 / Math.tan(fov / 2);
  return { x: w / 2 + (f * c.x1) / c.depth, y: h / 2 - (f * c.up) / c.depth };
}

/** Perspective projection. Returns null when the point is behind the near plane. */
export function project(cam: Camera3D, w: number, h: number, p: V3): { x: number; y: number; depth: number } | null {
  const c = toCamera(cam, p);
  if (c.depth < NEAR) return null;
  const s = camToScreen(c, w, h, cam.fov ?? DEFAULT_FOV);
  return { x: s.x, y: s.y, depth: c.depth };
}

/**
 * Clip a polygon in camera space against the near plane (depth ≥ NEAR),
 * Sutherland–Hodgman style. Faces straddling the camera keep rendering the
 * part that is in front of it instead of disappearing entirely.
 */
export function clipPolygonNear(pts: CamPt[]): CamPt[] {
  const out: CamPt[] = [];
  for (let i = 0; i < pts.length; i++) {
    const a = pts[i];
    const b = pts[(i + 1) % pts.length];
    const aIn = a.depth >= NEAR;
    const bIn = b.depth >= NEAR;
    if (aIn) out.push(a);
    if (aIn !== bIn) {
      const t = (NEAR - a.depth) / (b.depth - a.depth);
      out.push({
        x1: a.x1 + (b.x1 - a.x1) * t,
        up: a.up + (b.up - a.up) * t,
        depth: NEAR,
      });
    }
  }
  return out;
}

/** Camera that fits a whole floor on screen. */
export function fitCamera(floor: Floor): Camera3D {
  const span = Math.max(floor.width_m, floor.height_m);
  return {
    yaw: -0.62,
    pitch: 0.95, // ~54° — tilted, readable, still clearly 3D
    dist: span * 1.25,
    tx: floor.width_m / 2,
    ty: floor.height_m / 2,
    tz: 0,
  };
}

/**
 * Convert an eye position + look-at point into the orbit camera model.
 * Derived from the projection: forward = (cosP·sinYaw, cosP·cosYaw, −sinP).
 */
export function camFromEyeLook(eye: V3, look: V3): Camera3D {
  const fx = look.x - eye.x;
  const fy = look.y - eye.y;
  const fz = look.z - eye.z;
  const len = Math.hypot(fx, fy, fz) || 1;
  const sinP = Math.max(-1, Math.min(1, -fz / len));
  const pitch = Math.asin(sinP);
  const cosP = Math.cos(pitch);
  const yaw = Math.atan2(fx, fy);
  return { yaw, pitch, dist: len, tx: look.x, ty: look.y, tz: look.z };
}

/** Arc-length parameterized polyline sampler for camera flights. */
export function pathSampler(points: WorldPt[]) {
  const cum: number[] = [0];
  for (let i = 1; i < points.length; i++) {
    cum.push(cum[i - 1] + Math.hypot(points[i].x - points[i - 1].x, points[i].y - points[i - 1].y));
  }
  const total = cum[cum.length - 1];
  const segAt = (s: number): number => {
    // index of the segment containing arc position s
    let lo = 0;
    let hi = cum.length - 1;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (cum[mid + 1] < s) lo = mid + 1;
      else hi = mid;
    }
    return lo;
  };
  /** Unit heading (x, y) of the path at arc position s. */
  const headingAt = (s: number): WorldPt => {
    if (points.length < 2) return { x: 1, y: 0 };
    const sc = Math.max(0, Math.min(total, s));
    const i = Math.min(segAt(sc === total ? total - 1e-6 : sc), points.length - 2);
    const dx = points[i + 1].x - points[i].x;
    const dy = points[i + 1].y - points[i].y;
    const len = Math.hypot(dx, dy) || 1;
    return { x: dx / len, y: dy / len };
  };
  return {
    total,
    /** Point at arc position s; s beyond the ends extends straight along the end headings. */
    at(s: number): WorldPt {
      if (points.length === 1) return points[0];
      if (s <= 0) {
        const h = headingAt(0);
        return { x: points[0].x + h.x * s, y: points[0].y + h.y * s };
      }
      if (s >= total) {
        const h = headingAt(total);
        const over = s - total;
        const last = points[points.length - 1];
        return { x: last.x + h.x * over, y: last.y + h.y * over };
      }
      const i = segAt(s);
      const t = (s - cum[i]) / Math.max(cum[i + 1] - cum[i], 1e-9);
      return {
        x: points[i].x + (points[i + 1].x - points[i].x) * t,
        y: points[i].y + (points[i + 1].y - points[i].y) * t,
      };
    },
    headingAt,
  };
}

/* ---------------- colors ---------------- */

export function shade(hex: string, mult: number): string {
  const n = parseInt(hex.slice(1), 16);
  const ch = (v: number) => Math.max(0, Math.min(255, Math.round(v * mult)));
  const r = ch((n >> 16) & 255);
  const g = ch((n >> 8) & 255);
  const b = ch(n & 255);
  return `#${((r << 16) | (g << 8) | b).toString(16).padStart(6, '0')}`;
}

/**
 * Visual theme for the 3D scene. MODERN is the classic look; RETRO is the
 * optional "2010s 3D map" style (docs/DESIGN-RETRO-3D.md): saturated sky,
 * warm sun, two-tone gloss, contact shadows, glossy route, chunky labels.
 * Both are pure data — every themed function takes one as an optional arg
 * and defaults to MODERN, so existing callers and tests are unchanged.
 */
export interface MapTheme {
  floorFill: string;
  gridFill: string;
  skyTop: string;
  skyBottom: string;
  /** key-light direction (need not be normalized; z is up) */
  light: V3;
  ambient: number; // brightness floor
  diffuse: number; // how strongly facing the light matters
  retro: boolean;
}

export const MODERN_THEME: MapTheme = {
  floorFill: '#f5f3ec',
  gridFill: '#dfe3d8',
  skyTop: '#e3e9ef',
  skyBottom: '#eef0e8',
  light: { x: -0.38, y: -0.5, z: 0.78 },
  ambient: 0.55,
  diffuse: 0.45,
  retro: false,
};

export const RETRO_THEME: MapTheme = {
  floorFill: '#e9dcba', // warm parchment
  gridFill: '#d6c69a',
  skyTop: '#7cb2e2', // saturated 2010s blue…
  skyBottom: '#e6f0f9', // …fading to horizon haze
  light: { x: -0.45, y: -0.42, z: 0.78 }, // warm sun, still upper-left
  ambient: 0.42,
  diffuse: 0.58, // punchier contrast than modern
  retro: true,
};

function lit(normal: V3, base: string, theme: MapTheme = MODERN_THEME, extra = 1): string {
  const l =
    Math.abs(normal.x * theme.light.x + normal.y * theme.light.y + normal.z * theme.light.z) /
    Math.hypot(normal.x, normal.y, normal.z);
  return shade(base, (theme.ambient + theme.diffuse * l) * extra);
}

/** Flat-shaded box: side quads + top, from 4 base corners (world, y-down) and a height.
 *  Retro themes split every side quad into a sunlit upper band and darker base. */
export function boxFaces(
  base: WorldPt[],
  height: number,
  color: string,
  alpha = 1,
  theme: MapTheme = MODERN_THEME
): Face[] {
  if (base.length < 3 || height <= 0) return [];
  const t = base.map((p) => ({ x: p.x, y: p.y, z: height }));
  const b = base.map((p) => ({ x: p.x, y: p.y, z: 0 }));
  const faces: Face[] = [];
  // top face (normal up) — deliberately much brighter than any side (≈1.18×)
  // and outlined: at overview zoom the top is only a few pixels tall, so it
  // needs strong value separation from the front face to read as a surface
  faces.push({
    pts: t,
    fill: lit({ x: 0, y: 0, z: 1 }, color, theme, 1.18),
    stroke: shade(color, 0.55),
    lw: 1.1,
    alpha,
  });
  for (let i = 0; i < base.length; i++) {
    const j = (i + 1) % base.length;
    const n = { x: b[j].y - b[i].y, y: -(b[j].x - b[i].x), z: 0 }; // outward for CW bases in y-down coords
    if (theme.retro) {
      // 2010s plastic gloss: light catches the upper band, base sits in shade
      // (kept a notch below the top face so the cap stays the brightest plane)
      const f = 0.62;
      const mid = (p: V3, q: V3): V3 => ({ x: p.x + (q.x - p.x) * f, y: p.y + (q.y - p.y) * f, z: p.z + (q.z - p.z) * f });
      const m1 = mid(t[i], b[i]);
      const m2 = mid(t[j], b[j]);
      faces.push({ pts: [t[i], t[j], m2, m1], fill: lit(n, color, theme, 1.05), alpha });
      faces.push({ pts: [m1, m2, b[j], b[i]], fill: lit(n, color, theme, 0.66), alpha });
    } else {
      faces.push({ pts: [t[i], t[j], b[j], b[i]], fill: lit(n, color, theme, 0.94), alpha });
    }
  }
  return faces;
}

/* ---------------- scene construction ---------------- */

const ROUTE_COLOR = '#e4572e';

export const ROUTE = { ribbon: ROUTE_COLOR, width: 0.45, z: 0.07 };

/** Ribbon quads hugging the floor along a route polyline.
 *  Retro adds a glossy highlight strip and dashed centerline above the base. */
export function routeFaces(route: WorldPt[], theme: MapTheme = MODERN_THEME): Face[] {
  const faces: Face[] = [];
  const hw = ROUTE.width / 2;
  const z = ROUTE.z;
  for (let i = 1; i < route.length; i++) {
    const a = route[i - 1];
    const b = route[i];
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const len = Math.hypot(dx, dy);
    if (len < 1e-6) continue;
    const nx = (-dy / len) * hw;
    const ny = (dx / len) * hw;
    faces.push({
      pts: [
        { x: a.x + nx, y: a.y + ny, z },
        { x: b.x + nx, y: b.y + ny, z },
        { x: b.x - nx, y: b.y - ny, z },
        { x: a.x - nx, y: a.y - ny, z },
      ],
      fill: ROUTE.ribbon,
      layer: 1,
    });
  }
  // square patches at interior vertices so corners join without notches
  for (let i = 1; i < route.length - 1; i++) {
    const v = route[i];
    faces.push({
      pts: [
        { x: v.x - hw, y: v.y - hw, z },
        { x: v.x + hw, y: v.y - hw, z },
        { x: v.x + hw, y: v.y + hw, z },
        { x: v.x - hw, y: v.y + hw, z },
      ],
      fill: ROUTE.ribbon,
      layer: 1,
    });
  }
  if (!theme.retro) return faces;
  // 2010s GPS gloss: narrow bright strip riding the ribbon's centerline
  const hw2 = 0.09;
  const z2 = z + 0.01;
  for (let i = 1; i < route.length; i++) {
    const a = route[i - 1];
    const b = route[i];
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const len = Math.hypot(dx, dy);
    if (len < 1e-6) continue;
    const nx = (-dy / len) * hw2;
    const ny = (dx / len) * hw2;
    faces.push({
      pts: [
        { x: a.x + nx, y: a.y + ny, z: z2 },
        { x: b.x + nx, y: b.y + ny, z: z2 },
        { x: b.x - nx, y: b.y - ny, z: z2 },
        { x: a.x - nx, y: a.y - ny, z: z2 },
      ],
      fill: shade(ROUTE.ribbon, 1.32),
      layer: 1,
    });
  }
  // dashes above everything — the era's turn-by-turn look
  for (let i = 1; i < route.length; i++) {
    const a = route[i - 1];
    const b = route[i];
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const len = Math.hypot(dx, dy);
    if (len < 1e-6) continue;
    const ux = dx / len;
    const uy = dy / len;
    const nx = -uy * 0.05;
    const ny = ux * 0.05;
    for (let s = 0.6; s + 0.7 <= len; s += 1.3) {
      const mx = a.x + ux * (s + 0.35);
      const my = a.y + uy * (s + 0.35);
      faces.push({
        pts: [
          { x: mx - ux * 0.35 + nx, y: my - uy * 0.35 + ny, z: 0.09 },
          { x: mx + ux * 0.35 + nx, y: my + uy * 0.35 + ny, z: 0.09 },
          { x: mx + ux * 0.35 - nx, y: my + uy * 0.35 - ny, z: 0.09 },
          { x: mx - ux * 0.35 - nx, y: my - uy * 0.35 - ny, z: 0.09 },
        ],
        fill: '#fff2cf',
        alpha: 0.95,
        layer: 1,
      });
    }
  }
  return faces;
}

/**
 * 2010s contact shadows: one soft decal per solid rect fixture, offset away
 * from the theme's light by a height-scaled amount. Composed by the caller
 * (Map3D) next to the scene faces — never inside buildSceneFaces, whose exact
 * face counts are pinned by tests.
 */
export function buildContactShadows(elements: MapElement[], theme: MapTheme = MODERN_THEME): Face[] {
  const faces: Face[] = [];
  const lLen = Math.hypot(theme.light.x, theme.light.y) || 1;
  for (const el of elements) {
    const h = TYPE_HEIGHT[el.type] ?? 0;
    if (h <= 0.12 || el.shape !== 'rect') continue;
    const r = el.geom as RectGeom;
    if (r.w <= 0 || r.h <= 0) continue;
    const d = h * 0.45;
    const ox = (-theme.light.x / lLen) * d;
    const oy = (-theme.light.y / lLen) * d;
    faces.push({
      pts: rectCorners(r).map((p) => ({ x: p.x + ox, y: p.y + oy, z: 0.05 })),
      fill: '#1b2a20',
      alpha: 0.16,
      layer: 0.5,
    });
  }
  return faces;
}

function polyPrism(el: MapElement, pts: WorldPt[], height: number, theme: MapTheme = MODERN_THEME): Face[] {
  const base = el.color || TYPE_COLOR[el.type];
  if (height <= 0.12) {
    // flat decal (zone tint) — above the floor tiles so tiling can't cover it
    return [{ pts: pts.map((p) => ({ x: p.x, y: p.y, z: height })), fill: base, alpha: 0.35, layer: 0.5 }];
  }
  return boxFaces(pts, height, base, 1, theme);
}

/** Long faces break centroid-depth sorting — tile any quad whose edges exceed this. */
export const MAX_TILE_M = 4;
const MAX_TILES_PER_FACE = 128;

const lerp3 = (p: V3, q: V3, t: number): V3 => ({
  x: p.x + (q.x - p.x) * t,
  y: p.y + (q.y - p.y) * t,
  z: p.z + (q.z - p.z) * t,
});

/**
 * Split quads into ≤ MAX_TILE_M tiles (bilinear grid over the 4 corners).
 *
 * The painter's algorithm sorts faces by their centroid depth. A 54 m wall's
 * centroid sits at the store's middle, so a short shelf whose centroid happens
 * to be nearer than the wall's could paint over the wall section that is
 * actually in front of it. Tiling makes every centroid describe local depth,
 * which keeps occlusion correct between adjacent fixtures and walls.
 */
export function subdivideFaces(faces: Face[]): Face[] {
  const out: Face[] = [];
  for (const f of faces) {
    if (f.line || f.pts.length !== 4) {
      out.push(f);
      continue;
    }
    const [p0, p1, p2, p3] = f.pts;
    const uLen = Math.max(
      Math.hypot(p1.x - p0.x, p1.y - p0.y, p1.z - p0.z),
      Math.hypot(p2.x - p3.x, p2.y - p3.y, p2.z - p3.z)
    );
    const vLen = Math.max(
      Math.hypot(p3.x - p0.x, p3.y - p0.y, p3.z - p0.z),
      Math.hypot(p2.x - p1.x, p2.y - p1.y, p2.z - p1.z)
    );
    const nu = Math.min(16, Math.max(1, Math.ceil(uLen / MAX_TILE_M)));
    // horizontal solid faces (shelf tops) split finely along their depth: the
    // over-the-wall sliver must not flip visibility per whole tile (dashes)
    let vTile = MAX_TILE_M;
    if (f.layer === undefined || f.layer >= 2) {
      const e1 = { x: p1.x - p0.x, y: p1.y - p0.y, z: p1.z - p0.z };
      const e2 = { x: p2.x - p1.x, y: p2.y - p1.y, z: p2.z - p1.z };
      const nz = e1.x * e2.y - e1.y * e2.x;
      const nLen = Math.hypot(e1.x * e2.x + e1.y * e2.y + e1.z * e2.z, nz) || 1;
      if (Math.abs(nz) / nLen > 0.9) vTile = 0.6;
    }
    const nv = Math.min(16, Math.max(1, Math.ceil(vLen / vTile)));
    if (nu * nv === 1 || nu * nv > MAX_TILES_PER_FACE) {
      out.push(f);
      continue;
    }
    for (let i = 0; i < nu; i++) {
      for (let j = 0; j < nv; j++) {
        const u0 = i / nu;
        const u1 = (i + 1) / nu;
        const v0 = j / nv;
        const v1 = (j + 1) / nv;
        const bil = (u: number, v: number) => lerp3(lerp3(p0, p1, u), lerp3(p3, p2, u), v);
        out.push({ ...f, pts: [bil(u0, v0), bil(u1, v0), bil(u1, v1), bil(u0, v1)] });
      }
    }
  }
  return out;
}

/** All drawable faces for a floor: slab + grid (layer 0), decals (layer 0.5) and extruded elements (layer 2). */
export function buildSceneFaces(floor: Floor, elements: MapElement[], theme: MapTheme = MODERN_THEME): Face[] {
  const faces: Face[] = [];
  const w = floor.width_m;
  const h = floor.height_m;

  // floor slab
  faces.push({
    pts: [
      { x: 0, y: 0, z: 0 },
      { x: w, y: 0, z: 0 },
      { x: w, y: h, z: 0 },
      { x: 0, y: h, z: 0 },
    ],
    fill: theme.floorFill,
    layer: 0,
  });
  // 1 m grid — above the floor tiles (they're markings, and their 54 m centroids
  // would otherwise lose the depth race against nearby floor tiles)
  for (let gx = 1; gx < w; gx++) {
    faces.push({
      pts: [{ x: gx, y: 0, z: 0 }, { x: gx, y: h, z: 0 }],
      stroke: theme.gridFill,
      lw: 1,
      layer: 0.25,
      line: true,
    });
  }
  for (let gy = 1; gy < h; gy++) {
    faces.push({
      pts: [{ x: 0, y: gy, z: 0 }, { x: w, y: gy, z: 0 }],
      stroke: theme.gridFill,
      lw: 1,
      layer: 0.25,
      line: true,
    });
  }

  for (const el of elements) {
    const color = el.color || TYPE_COLOR[el.type];
    if (el.shape === 'rect') {
      const r = el.geom as RectGeom;
      const height = TYPE_HEIGHT[el.type] ?? 0;
      if (r.w <= 0 || r.h <= 0) continue;
      if (height <= 0.12) {
        faces.push({
          pts: rectCorners(r).map((p) => ({ x: p.x, y: p.y, z: height })),
          fill: color,
          alpha: el.type === 'zone' ? 0.35 : 1,
          layer: 0.5,
        });
      } else {
        faces.push(...boxFaces(rectCorners(r), height, color, 1, theme));
      }
    } else if (el.shape === 'polygon') {
      const pts = polyPoints(el);
      if (pts.length >= 3) faces.push(...polyPrism(el, pts, TYPE_HEIGHT[el.type] ?? 0, theme));
    } else if (el.shape === 'polyline') {
      const pts = polyPoints(el);
      if (el.type === 'wall') {
        for (let i = 1; i < pts.length; i++) {
          const a = pts[i - 1];
          const b = pts[i];
          const dx = b.x - a.x;
          const dy = b.y - a.y;
          const len = Math.hypot(dx, dy);
          if (len < 1e-6) continue;
          const nx = (-dy / len) * 0.11;
          const ny = (dx / len) * 0.11;
          const base = [
            { x: a.x + nx, y: a.y + ny },
            { x: b.x + nx, y: b.y + ny },
            { x: b.x - nx, y: b.y - ny },
            { x: a.x - nx, y: a.y - ny },
          ];
          faces.push(...boxFaces(base, TYPE_HEIGHT.wall, color, 1, theme));
        }
      } else {
        // aisle / route-like marking: flat ribbon
        for (let i = 1; i < pts.length; i++) {
          const a = pts[i - 1];
          const b = pts[i];
          const dx = b.x - a.x;
          const dy = b.y - a.y;
          const len = Math.hypot(dx, dy);
          if (len < 1e-6) continue;
          const nx = (-dy / len) * 0.2;
          const ny = (dx / len) * 0.2;
          faces.push({
            pts: [
              { x: a.x + nx, y: a.y + ny, z: 0.03 },
              { x: b.x + nx, y: b.y + ny, z: 0.03 },
              { x: b.x - nx, y: b.y - ny, z: 0.03 },
              { x: a.x - nx, y: a.y - ny, z: 0.03 },
            ],
            fill: color,
            alpha: 0.6,
            layer: 0.5,
          });
        }
      }
    } else if (el.shape === 'point') {
      // markers are drawn as billboards in the overlay pass (see renderScene)
    }
  }
  return subdivideFaces(faces);
}

/* ---------------- depth ordering: axis-aligned BSP ---------------- */

export interface FaceBSP {
  axis: 0 | 1 | 2;
  split: number;
  below: FaceBSP | null;
  above: FaceBSP | null;
  faces: Face[]; // faces lying exactly on this node's split plane (or a small leaf)
}

const faceAxisValue = (p: V3, axis: 0 | 1 | 2) => (axis === 0 ? p.x : axis === 1 ? p.y : p.z);

/** Split a face by the plane `axis = value`; returns [below-piece, above-piece]. */
function splitFaceByPlane(f: Face, axis: 0 | 1 | 2, value: number): [Face[], Face[]] {
  const cut = (pts: V3[], keepBelow: boolean): V3[] => {
    const out: V3[] = [];
    for (let i = 0; i < pts.length; i++) {
      const a = pts[i];
      const b = pts[(i + 1) % pts.length];
      const av = faceAxisValue(a, axis);
      const bv = faceAxisValue(b, axis);
      const aIn = keepBelow ? av <= value : av >= value;
      const bIn = keepBelow ? bv <= value : bv >= value;
      if (aIn) out.push(a);
      if (aIn !== bIn && bv !== av) out.push(lerp3(a, b, (value - av) / (bv - av)));
    }
    return out;
  };
  const res: [Face[], Face[]] = [[], []];
  const belowPts = cut(f.pts, true);
  const abovePts = cut(f.pts, false);
  if (belowPts.length >= (f.line ? 2 : 3)) res[0].push({ ...f, pts: belowPts });
  if (abovePts.length >= (f.line ? 2 : 3)) res[1].push({ ...f, pts: abovePts });
  return res;
}

/**
 * Axis-aligned BSP over the scene's faces. Traversed back-to-front from the eye
 * it yields an EXACT draw order for any camera position — the correct-occlusion
 * guarantee a centroid sort can only approximate. Built once per data change and
 * cached with the scene; per-frame cost is a linear traversal.
 */
export function buildFaceBSP(faces: Face[], depth = 0): FaceBSP | null {
  if (faces.length === 0) return null;
  if (faces.length <= 1 || depth > 24) {
    // a single face (or a rare unresolvably deep leaf): nothing left to order
    return { axis: 0, split: 0, below: null, above: null, faces };
  }

  // splitter: the largest-area face — its own plane becomes the split plane.
  // Every other face is partitioned/split against it, so the node always
  // consumes one face and the recursion terminates.
  let best = 0;
  let bestArea = -1;
  faces.forEach((f, i) => {
    let cx = 0, cy = 0, cz = 0;
    for (let k = 0; k < f.pts.length; k++) {
      const a = f.pts[k];
      const b = f.pts[(k + 1) % f.pts.length];
      cx += a.y * b.z - a.z * b.y;
      cy += a.z * b.x - a.x * b.z;
      cz += a.x * b.y - a.y * b.x;
    }
    const area = 0.5 * Math.hypot(cx, cy, cz);
    if (area > bestArea) {
      bestArea = area;
      best = i;
    }
  });
  const splitter = faces[best];
  // dominant axis of the splitter face
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity, minZ = Infinity, maxZ = -Infinity;
  for (const p of splitter.pts) {
    minX = Math.min(minX, p.x); maxX = Math.max(maxX, p.x);
    minY = Math.min(minY, p.y); maxY = Math.max(maxY, p.y);
    minZ = Math.min(minZ, p.z); maxZ = Math.max(maxZ, p.z);
  }
  // the split plane is the splitter face's OWN plane: its thinnest axis
  // (an axis-aligned face has ~zero extent along its plane's normal)
  const spans: [number, number, number] = [maxX - minX, maxY - minY, maxZ - minZ];
  const axis: 0 | 1 | 2 = spans[0] <= spans[1] && spans[0] <= spans[2] ? 0 : spans[1] <= spans[2] ? 1 : 2;
  let splitSum = 0;
  for (const p of splitter.pts) splitSum += faceAxisValue(p, axis);
  const split = splitSum / splitter.pts.length;

  const below: Face[] = [];
  const above: Face[] = [];
  const onPlane: Face[] = [];
  faces.forEach((f, i) => {
    if (i === best) {
      onPlane.push(f);
      return;
    }
    let flo = Infinity;
    let fhi = -Infinity;
    for (const p of f.pts) {
      const v = faceAxisValue(p, axis);
      flo = Math.min(flo, v);
      fhi = Math.max(fhi, v);
    }
    if (fhi <= split + 1e-9) below.push(f);
    else if (flo >= split - 1e-9) above.push(f);
    else {
      const [loFaces, hiFaces] = splitFaceByPlane(f, axis, split);
      // the plane can graze a vertex: one side may come back empty
      if (loFaces.length) below.push(...loFaces);
      if (hiFaces.length) above.push(...hiFaces);
      if (!loFaces.length && !hiFaces.length) onPlane.push(f);
    }
  });

  return {
    axis,
    split,
    below: buildFaceBSP(below, depth + 1),
    above: buildFaceBSP(above, depth + 1),
    faces: onPlane,
  };
}

/** Back-to-front traversal: faces on the far side of each plane draw first. */
export function traverseFaceBSP(node: FaceBSP | null, eye: V3, out: Face[]): void {
  if (!node) return;
  const eyeAt = faceAxisValue(eye, node.axis);
  if (eyeAt > node.split) {
    traverseFaceBSP(node.below, eye, out);
    for (const f of node.faces) out.push(f);
    traverseFaceBSP(node.above, eye, out);
  } else {
    traverseFaceBSP(node.above, eye, out);
    for (const f of node.faces) out.push(f);
    traverseFaceBSP(node.below, eye, out);
  }
}

export interface LayeredBSP {
  layer: number;
  node: FaceBSP | null;
}

/** One BSP per draw layer (floor → grid → decals → route → solids), sorted. */
export function buildSceneBSP(faces: Face[]): LayeredBSP[] {
  const groups = new Map<number, Face[]>();
  for (const f of faces) {
    const layer = f.layer ?? 2;
    let g = groups.get(layer);
    if (!g) groups.set(layer, (g = []));
    g.push(f);
  }
  return [...groups.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([layer, fs]) => ({ layer, node: buildFaceBSP(fs) }));
}

/* ---------------- drawing ---------------- */

export interface Pin3D {
  productId: string;
  x: number;
  y: number;
  color: string;
  label?: string;
  focused?: boolean;
  /** When set, the item is stocked on a shelf: the dot sits on that wall face. */
  ax?: number;
  ay?: number;
}

export interface PinHit {
  productId: string;
  sx: number;
  sy: number;
}

/** Hoverable aisle symbol position (screen px). */
export interface AisleHit {
  elementId: string;
  sx: number;
  sy: number;
}

/** Everything the caller needs for hit-testing after a frame. */
export interface SceneHits {
  pins: PinHit[];
  aisles: AisleHit[];
}

/** Decorative product facing standing on a shelf's wall face. */
export interface StockItem {
  x: number;
  y: number;
  nx: number; // outward normal of the shelf face at this spot
  ny: number;
  color: string;
}

/** Eye position of the orbit camera in world space. */
export function cameraEye(cam: Camera3D): V3 {
  const cosP = Math.cos(cam.pitch);
  const sinP = Math.sin(cam.pitch);
  return {
    x: cam.tx + cam.dist * cosP * Math.sin(cam.yaw),
    y: cam.ty + cam.dist * cosP * Math.cos(cam.yaw),
    z: cam.tz + cam.dist * sinP,
  };
}

/** Vertical product blocks along the shelf faces — makes fixtures look stocked.
 *  No camera culling: the scene BSP orders every block exactly, so back-facing
 *  blocks end up covered by the shelf's own front faces. */
export function stockFaces(items: StockItem[], theme: MapTheme = MODERN_THEME): Face[] {
  const faces: Face[] = [];
  const halfW = 0.45; // half-width along the face
  const z0 = 0.32;
  const z1 = 1.18;
  const off = 0.04; // stand slightly proud of the wall
  for (const it of items) {
    const tx = -it.ny;
    const ty = it.nx;
    const ox = it.x + it.nx * off;
    const oy = it.y + it.ny * off;
    faces.push({
      pts: [
        { x: ox + tx * halfW, y: oy + ty * halfW, z: z1 },
        { x: ox - tx * halfW, y: oy - ty * halfW, z: z1 },
        { x: ox - tx * halfW, y: oy - ty * halfW, z: z0 },
        { x: ox + tx * halfW, y: oy + ty * halfW, z: z0 },
      ],
      fill: shade(it.color, theme.retro ? 0.97 : 0.92),
    });
  }
  return faces;
}

export interface SceneInput {
  route?: WorldPt[] | null;
  pins?: Pin3D[];
  routeStart?: WorldPt | null;
  labels?: boolean;
  /** Product blocks drawn on the shelf faces (visual stocking). */
  stocking?: StockItem[];
  /** Pre-built static geometry — pass a cached buildSceneFaces result to skip
   *  rebuilding it every frame (camera changes don't affect it). */
  faces?: Face[];
  /** Exact depth ordering: one BSP per draw layer, built by the caller from the
   *  scene + stocking + route faces. When present, the painter sort is skipped. */
  bsp?: LayeredBSP[] | null;
  /** Multi-stop trip: numbered markers drawn in the overlay pass. */
  tripStops?: { productId: string; name: string; point: WorldPt }[];
  /** Visual theme — defaults to the modern look; RETRO_THEME adds the 2010s style. */
  theme?: MapTheme;
}

/**
 * Draw one frame. Returns projected pin + aisle-symbol positions for hit-testing.
 * Faces straddling the camera are clipped against the near plane, not skipped;
 * with input.bsp the draw order is the exact BSP back-to-front traversal.
 */
export function renderScene(
  ctx: CanvasRenderingContext2D,
  w: number,
  h: number,
  cam: Camera3D,
  floor: Floor,
  elements: MapElement[],
  input: SceneInput = {}
): SceneHits {
  const fov = cam.fov ?? DEFAULT_FOV;
  const theme = input.theme ?? MODERN_THEME;
  interface Draw {
    face: Face;
    spts: { x: number; y: number }[];
    depth: number;
  }
  const projectFace = (face: Face): Draw | null => {
    const cams = face.pts.map((p) => toCamera(cam, p));
    if (cams.every((c) => c.depth < NEAR)) return null;
    let vis = cams;
    if (cams.some((c) => c.depth < NEAR)) vis = clipPolygonNear(cams);
    if (!vis || vis.length < 2) return null;
    const spts = vis.map((c) => camToScreen(c, w, h, fov));
    return { face, spts, depth: vis.reduce((a, c) => a + c.depth, 0) / vis.length };
  };

  const draws: Draw[] = [];
  if (input.bsp) {
    // exact back-to-front order for this camera — nothing disappears, and
    // "which shape is in front" is resolved geometrically, not by heuristic
    const ordered: Face[] = [];
    for (const { node } of input.bsp) traverseFaceBSP(node, cameraEye(cam), ordered);
    for (const face of ordered) {
      const d = projectFace(face);
      if (d) draws.push(d);
    }
  } else {
    // legacy painter path — IMPORTANT: never mutate input.faces, callers cache it
    const all: Face[] = input.faces ? input.faces.slice() : buildSceneFaces(floor, elements, theme);
    if (input.stocking?.length) all.push(...stockFaces(input.stocking, theme));
    if (input.route && input.route.length > 1) all.push(...routeFaces(input.route, theme));
    for (const face of all) {
      const d = projectFace(face);
      if (d) draws.push(d);
    }
    // painter's algorithm: lower layers first, then farthest first within a layer
    draws.sort((a, b) => (a.face.layer ?? 2) - (b.face.layer ?? 2) || b.depth - a.depth);
  }

  // sky → ground backdrop
  const bg = ctx.createLinearGradient(0, 0, 0, h);
  bg.addColorStop(0, theme.skyTop);
  bg.addColorStop(1, theme.skyBottom);
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, w, h);

  ctx.lineJoin = 'round';
  for (const { face, spts } of draws) {
    ctx.beginPath();
    ctx.moveTo(spts[0].x, spts[0].y);
    for (let i = 1; i < spts.length; i++) ctx.lineTo(spts[i].x, spts[i].y);
    if (face.line) {
      ctx.strokeStyle = face.stroke ?? '#ccc';
      ctx.lineWidth = face.lw ?? 1;
      ctx.stroke();
      continue;
    }
    ctx.closePath();
    if (face.fill) {
      ctx.globalAlpha = face.alpha ?? 1;
      ctx.fillStyle = face.fill;
      ctx.fill();
      ctx.globalAlpha = 1;
    }
    if (face.stroke) {
      ctx.strokeStyle = face.stroke;
      ctx.lineWidth = face.lw ?? 1;
      ctx.stroke();
    }
  }
  if (theme.retro) {
    // 2010s vignette — after the scene, before the overlay, so pins and labels
    // stay crisp and untinted
    const cx = w / 2;
    const cy = h * 0.46;
    const vg = ctx.createRadialGradient(cx, cy, Math.min(w, h) * 0.45, cx, cy, Math.max(w, h) * 0.78);
    vg.addColorStop(0, 'rgba(24,34,54,0)');
    vg.addColorStop(1, 'rgba(24,34,54,0.2)');
    ctx.fillStyle = vg;
    ctx.fillRect(0, 0, w, h);
  }

  /* ---- overlay: markers, pins, labels (always on top) ---- */
  const hits: SceneHits = { pins: [], aisles: [] };
  const pitchSin = Math.sin(cam.pitch);

  // entrance / exit / POI markers: ground disc + tall pole + glyph head —
  // big enough to spot from the default overview angle
  for (const el of elements) {
    if (el.shape !== 'point') continue;
    const g = el.geom as PointGeom;
    const base = project(cam, w, h, { x: g.x, y: g.y, z: 0 });
    const top = project(cam, w, h, { x: g.x, y: g.y, z: 2.0 });
    if (!base || !top) continue;
    const c = el.color || TYPE_COLOR[el.type];
    const glyph = el.type === 'entrance' ? '⬆' : el.type === 'exit' ? '⬇' : '★';
    // ground disc anchors the marker to its spot on the floor
    ctx.beginPath();
    ctx.ellipse(base.x, base.y, 11, Math.max(11 * pitchSin, 2), 0, 0, Math.PI * 2);
    ctx.fillStyle = c;
    ctx.globalAlpha = 0.35;
    ctx.fill();
    ctx.globalAlpha = 1;
    ctx.strokeStyle = c;
    ctx.lineWidth = 2.5;
    ctx.beginPath();
    ctx.moveTo(base.x, base.y);
    ctx.lineTo(top.x, top.y);
    ctx.stroke();
    // glyph head with a white ring
    ctx.beginPath();
    ctx.arc(top.x, top.y, 10, 0, Math.PI * 2);
    ctx.fillStyle = c;
    ctx.fill();
    ctx.strokeStyle = '#fff';
    ctx.lineWidth = 2.2;
    ctx.stroke();
    ctx.fillStyle = '#fff';
    ctx.font = '700 11px ui-sans-serif, system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(glyph, top.x, top.y + 0.5);
    if (el.label) drawLabel(ctx, top.x + 16, top.y, el.label, 12, true, theme.retro);
  }

  // aisle symbols: floating disc above the aisle's midpoint; hovering it (see
  // AisleHit) shows what's stocked along the aisle
  for (const el of elements) {
    if (el.type !== 'aisle' || el.shape !== 'polyline') continue;
    const mid = polyMidpoint(polyPoints(el));
    if (!mid) continue;
    const base = project(cam, w, h, { x: mid.x, y: mid.y, z: 0.1 });
    const top = project(cam, w, h, { x: mid.x, y: mid.y, z: 2.3 });
    if (!base || !top) continue;
    ctx.strokeStyle = 'rgba(93, 110, 100, 0.7)';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(base.x, base.y);
    ctx.lineTo(top.x, top.y);
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(top.x, top.y, 11, 0, Math.PI * 2);
    ctx.fillStyle = '#f4f6f1';
    ctx.fill();
    ctx.strokeStyle = '#5d6e64';
    ctx.lineWidth = 2;
    ctx.stroke();
    ctx.fillStyle = '#33413a';
    ctx.font = '800 12px ui-sans-serif, system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('≡', top.x, top.y + 0.5);
    hits.aisles.push({ elementId: el.id, sx: top.x, sy: top.y });
    if (el.label) drawLabel(ctx, top.x, top.y - 17, el.label, 11.5, false, theme.retro);
  }

  // numbered trip stop markers (A1) — drawn above the route discs
  for (const [i, stop] of (input.tripStops ?? []).entries()) {
    const pr = project(cam, w, h, { x: stop.point.x, y: stop.point.y, z: 0.1 });
    if (!pr) continue;
    ctx.beginPath();
    ctx.arc(pr.x, pr.y, 10, 0, Math.PI * 2);
    ctx.fillStyle = '#e4572e';
    ctx.fill();
    ctx.strokeStyle = '#fff';
    ctx.lineWidth = 2.5;
    ctx.stroke();
    ctx.fillStyle = '#fff';
    ctx.font = '700 11px ui-sans-serif, system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(String(i + 1), pr.x, pr.y + 0.5);
  }

  // route endpoint markers
  if (input.route && input.route.length > 1) {
    if (input.routeStart) drawFloorDisc(ctx, cam, w, h, input.routeStart, 0.5, '#2f6f3e', pitchSin);
    const goal = input.route[input.route.length - 1];
    drawFloorDisc(ctx, cam, w, h, goal, 0.5, ROUTE.ribbon, pitchSin);
  }

  // product pins — stocked items render as a dot on the shelf's wall face
  for (const pin of input.pins ?? []) {
    const ax = pin.ax ?? pin.x;
    const ay = pin.ay ?? pin.y;
    const onShelf = pin.ax !== undefined && pin.ay !== undefined;
    const px = onShelf ? ax : pin.x;
    const py = onShelf ? ay : pin.y;
    if (onShelf) {
      const dot = project(cam, w, h, { x: px, y: py, z: 1.05 });
      if (!dot) continue;
      hits.pins.push({ productId: pin.productId, sx: dot.x, sy: dot.y });
      const r = pin.focused ? 9 : 6.5;
      ctx.beginPath();
      ctx.arc(dot.x, dot.y, r, 0, Math.PI * 2);
      ctx.fillStyle = pin.color;
      ctx.fill();
      ctx.strokeStyle = '#fff';
      ctx.lineWidth = 2;
      ctx.stroke();
      if (pin.focused) {
        drawFloorDisc(ctx, cam, w, h, { x: px, y: py }, 0.55, pin.color, pitchSin, true);
        if (pin.label) drawLabel(ctx, dot.x, dot.y - 14, pin.label, 13, true, theme.retro);
      }
      continue;
    }
    const base = project(cam, w, h, { x: pin.x, y: pin.y, z: 0 });
    if (!base) continue;
    hits.pins.push({ productId: pin.productId, sx: base.x, sy: base.y });
    // free-standing pin: pole clears the 1.5 m shelves so the marker stays visible
    const poleH = pin.focused ? 2.6 : 2.1;
    const top = project(cam, w, h, { x: pin.x, y: pin.y, z: poleH });
    if (top) {
      ctx.strokeStyle = shade(pin.color, 0.75);
      ctx.lineWidth = pin.focused ? 3 : 2;
      ctx.beginPath();
      ctx.moveTo(base.x, base.y);
      ctx.lineTo(top.x, top.y);
      ctx.stroke();
      const r = pin.focused ? 8.5 : 6.5;
      ctx.beginPath();
      ctx.arc(top.x, top.y, r, 0, Math.PI * 2);
      ctx.fillStyle = pin.color;
      ctx.fill();
      ctx.strokeStyle = '#fff';
      ctx.lineWidth = 2;
      ctx.stroke();
    }
    if (pin.focused) {
      drawFloorDisc(ctx, cam, w, h, { x: pin.x, y: pin.y }, 0.55, pin.color, pitchSin, true);
      if (pin.label) drawLabel(ctx, top?.x ?? base.x, (top?.y ?? base.y) - 14, pin.label, 13, true, theme.retro);
    }
  }

  // element labels (zones/shelves/markers) — readable wayfinding
  if (input.labels !== false) {
    const drawnAt = new Map<string, { x: number; y: number }>();
    for (const el of elements) {
      if (!el.label) continue;
      let c: WorldPt | null = null;
      let topZ = 0;
      if (el.shape === 'rect') {
        const r = el.geom as RectGeom;
        c = { x: r.x + r.w / 2, y: r.y + r.h / 2 };
        topZ = TYPE_HEIGHT[el.type] ?? 0;
      } else if (el.shape === 'point') {
        c = el.geom as PointGeom;
        topZ = 1.5;
      } else if (el.shape === 'polygon') {
        const pts = polyPoints(el) as WorldPt[];
        c = pts.reduce((a, p) => ({ x: a.x + p.x / pts.length, y: a.y + p.y / pts.length }), { x: 0, y: 0 });
        topZ = TYPE_HEIGHT[el.type] ?? 0;
      }
      if (!c) continue;
      const pr = project(cam, w, h, { x: c.x, y: c.y, z: topZ + 0.05 });
      if (!pr || pr.depth > 90) continue;
      if (pr.x < -40 || pr.x > w + 40 || pr.y < -20 || pr.y > h + 20) continue;
      // same text projected nearby (e.g. "Aisle 1" on adjacent segments) → draw once
      const key = el.label.trim().toLowerCase();
      const prev = drawnAt.get(key);
      if (prev && Math.hypot(prev.x - pr.x, prev.y - pr.y) < 140) continue;
      drawnAt.set(key, { x: pr.x, y: pr.y });
      const size = Math.max(8.5, Math.min(14, 260 / pr.depth));
      drawLabel(ctx, pr.x, pr.y, el.label, size, false, theme.retro);
    }
  }

  return hits;
}

function drawFloorDisc(
  ctx: CanvasRenderingContext2D,
  cam: Camera3D,
  w: number,
  h: number,
  at: WorldPt,
  rM: number,
  color: string,
  pitchSin: number,
  ring = false
) {
  const c = project(cam, w, h, { x: at.x, y: at.y, z: 0 });
  const edge = project(cam, w, h, { x: at.x + rM, y: at.y, z: 0 });
  if (!c || !edge) return;
  const rx = Math.abs(edge.x - c.x);
  ctx.beginPath();
  ctx.ellipse(c.x, c.y, rx, Math.max(rx * pitchSin, 1), 0, 0, Math.PI * 2);
  if (ring) {
    ctx.strokeStyle = color;
    ctx.lineWidth = 3;
    ctx.stroke();
  } else {
    ctx.fillStyle = color;
    ctx.globalAlpha = 0.9;
    ctx.fill();
    ctx.globalAlpha = 1;
  }
}

function drawLabel(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  text: string,
  size: number,
  bold = false,
  retro = false
) {
  ctx.font = `${bold ? '700 ' : ''}${size}px ui-sans-serif, system-ui, -apple-system, sans-serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  if (retro) {
    // 2010s signpost: warm halo behind a crisp dark outline around cream text
    ctx.lineWidth = Math.max(3.4, size / 3);
    ctx.strokeStyle = 'rgba(255, 243, 196, 0.6)';
    ctx.strokeText(text, x, y);
    ctx.lineWidth = Math.max(2.2, size / 4.5);
    ctx.strokeStyle = '#26313d';
    ctx.strokeText(text, x, y);
    ctx.fillStyle = '#fffdf6';
    ctx.fillText(text, x, y);
    return;
  }
  ctx.lineWidth = Math.max(2.5, size / 4);
  ctx.strokeStyle = 'rgba(255,255,255,0.85)';
  ctx.strokeText(text, x, y);
  ctx.fillStyle = '#333a33';
  ctx.fillText(text, x, y);
}
