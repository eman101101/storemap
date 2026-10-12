/** Tests for the lightweight 3D renderer — projection, mesh building, colors. */
import { describe, it, expect } from 'vitest';
import type { Floor, MapElement } from '../types';
import {
  project, fitCamera, boxFaces, routeFaces, buildSceneFaces, shade, ROUTE,
  camFromEyeLook, pathSampler, toCamera, clipPolygonNear, stockFaces, subdivideFaces,
  buildSceneBSP, traverseFaceBSP, buildContactShadows, MODERN_THEME, RETRO_THEME, NEAR,
  type Face,
} from './render3d';

const floor: Floor = {
  id: 'f1', store_id: 's1', name: 'Main', level: 0, width_m: 20, height_m: 14, background_url: '',
};

let seq = 0;
const el = (type: MapElement['type'], shape: MapElement['shape'], geom: unknown): MapElement => ({
  id: `e${++seq}`,
  floor_id: 'f1',
  type,
  shape,
  geom: geom as MapElement['geom'],
  label: '',
  color: '',
  meta: '',
  z_index: 1,
});

const W = 800;
const H = 600;

describe('projection', () => {
  const cam = { yaw: 0, pitch: Math.PI / 2, dist: 30, tx: 10, ty: 7, tz: 0 };

  it('looking straight down maps the floor plane like the 2D map (y down)', () => {
    const left = project(cam, W, H, { x: 5, y: 7, z: 0 })!;
    const right = project(cam, W, H, { x: 15, y: 7, z: 0 })!;
    const top = project(cam, W, H, { x: 10, y: 3, z: 0 })!;
    const bottom = project(cam, W, H, { x: 10, y: 11, z: 0 })!;
    expect(left.x).toBeLessThan(right.x);
    // world +y must point down the screen, matching the 2D viewer
    expect(top.y).toBeLessThan(bottom.y);
    expect(left.x).toBeLessThan(W / 2);
    expect(right.x).toBeGreaterThan(W / 2);
  });

  it('depth decreases as points get closer to the eye', () => {
    const cam2 = { yaw: 0, pitch: 0.5, dist: 30, tx: 10, ty: 7, tz: 0 };
    const near = project(cam2, W, H, { x: 10, y: 9, z: 0 })!; // camera sits on +y side
    const far = project(cam2, W, H, { x: 10, y: 5, z: 0 })!;
    expect(near.depth).toBeLessThan(far.depth);
  });

  it('nearer points project farther from the image center', () => {
    const cam2 = { yaw: 0, pitch: 0.5, dist: 30, tx: 10, ty: 7, tz: 0 };
    const near = project(cam2, W, H, { x: 8, y: 9, z: 0 })!;
    const far = project(cam2, W, H, { x: 8, y: 5, z: 0 })!;
    expect(Math.abs(near.x - W / 2)).toBeGreaterThan(Math.abs(far.x - W / 2));
  });

  it('elevated points rise on screen when tilted', () => {
    const cam2 = { yaw: 0, pitch: 0.9, dist: 25, tx: 10, ty: 7, tz: 0 };
    const base = project(cam2, W, H, { x: 10, y: 7, z: 0 })!;
    const raised = project(cam2, W, H, { x: 10, y: 7, z: 2 })!;
    expect(raised.y).toBeLessThan(base.y);
  });

  it('returns null behind the camera', () => {
    const closeCam = { yaw: 0, pitch: 0.2, dist: 1, tx: 0, ty: 0, tz: 0 };
    expect(project(closeCam, W, H, { x: 0, y: 5, z: 0 })).toBeNull();
  });
});

describe('box faces', () => {
  it('builds a top face plus one quad per side, with shading variety', () => {
    const base = [
      { x: 4, y: 4 }, { x: 8, y: 4 }, { x: 8, y: 7 }, { x: 4, y: 7 },
    ];
    const faces = boxFaces(base, 1.5, '#e7d5a8');
    expect(faces).toHaveLength(5); // top + 4 sides
    expect(faces[0].pts.every((p) => p.z === 1.5)).toBe(true);
    const side = faces[1];
    expect(side.pts.some((p) => p.z === 0)).toBe(true);
    expect(side.pts.some((p) => p.z === 1.5)).toBe(true);
    // distinct normals produce at least 3 distinct shades (top + 2 side levels)
    expect(new Set(faces.map((f) => f.fill)).size).toBeGreaterThanOrEqual(3);
  });

  it('is a no-op for degenerate input', () => {
    expect(boxFaces([{ x: 0, y: 0 }], 1.5, '#fff')).toEqual([]);
    expect(boxFaces([{ x: 0, y: 0 }, { x: 1, y: 1 }, { x: 2, y: 2 }], 0, '#fff')).toEqual([]);
  });
});

describe('route ribbon', () => {
  it('hugs the floor at ribbon height with the ribbon width', () => {
    const faces = routeFaces([{ x: 2, y: 2 }, { x: 8, y: 2 }]);
    expect(faces).toHaveLength(1);
    const f = faces[0];
    expect(f.pts.every((p) => p.z === ROUTE.z)).toBe(true);
    expect(f.layer).toBe(1);
    // perpendicular offset = width/2 on both sides
    const ys = f.pts.map((p) => p.y);
    expect(Math.min(...ys)).toBeCloseTo(2 - ROUTE.width / 2, 5);
    expect(Math.max(...ys)).toBeCloseTo(2 + ROUTE.width / 2, 5);
  });
});

describe('scene construction', () => {
  it('emits the floor slab, a 1 m grid, and extruded elements at their heights', () => {
    const els = [
      el('shelf', 'rect', { x: 4, y: 4, w: 3, h: 1, rot: 0 }),
      el('wall', 'polyline', [[2, 2], [6, 2]]),
    ];
    const faces = buildSceneFaces(floor, els);
    // slab + 19 vertical + 13 horizontal grid lines
    const gridLines = faces.filter((f) => f.line);
    expect(gridLines).toHaveLength(32);
    const slab = faces.find((f) => !f.line && f.pts.length === 4 && f.pts.every((p) => p.z === 0))!;
    expect(slab).toBeTruthy();
    // shelf reaches 1.5 m, wall line 3.2 m
    const shelfZ = Math.max(...faces.filter((f) => f.pts.some((p) => p.z > 1.4 && p.z < 1.6)).flatMap((f) => f.pts.map((p) => p.z)));
    expect(shelfZ).toBeCloseTo(1.5, 5);
    expect(Math.max(...faces.filter((f) => f.pts.some((p) => p.z > 3)).flatMap((f) => f.pts.map((p) => p.z)))).toBeCloseTo(3.2, 5);
  });

  it('point markers are billboards — no extruded geometry', () => {
    const faces = buildSceneFaces(floor, [el('entrance', 'point', { x: 1, y: 13 })]);
    // only the floor slab remains, tiled 5×4 for the 20×14 m test floor
    expect(faces.filter((f) => !f.line)).toHaveLength(20);
  });

  describe('face BSP — exact depth ordering', () => {
  // a wall at x=5 and a shelf top behind it (x 6..7); eye sides decide order
  const wall = {
    pts: [{ x: 5, y: 0, z: 0 }, { x: 5, y: 4, z: 0 }, { x: 5, y: 4, z: 3 }, { x: 5, y: 0, z: 3 }],
    fill: '#0f0',
    layer: 2,
  };
  const shelf = {
    pts: [{ x: 6, y: 0, z: 1.5 }, { x: 7, y: 0, z: 1.5 }, { x: 7, y: 2, z: 1.5 }, { x: 6, y: 2, z: 1.5 }],
    fill: '#f0f',
    layer: 2,
  };

  it('draws the far face first and the near face last, from either side', () => {
    const bsp = buildSceneBSP([shelf, wall]);
    const draw = (eye: { x: number; y: number; z: number }) => {
      const out: Face[] = [];
      for (const { node } of bsp) traverseFaceBSP(node, eye, out);
      return out;
    };
    const fromWest = draw({ x: 0, y: 2, z: 5 });
    expect(fromWest).toHaveLength(2);
    // the wall plane (x=5) sits between the west eye and the shelf:
    // shelf (far) draws first, wall (near) last
    expect(fromWest[0]!.fill).toBe('#f0f');
    expect(fromWest[1]!.fill).toBe('#0f0');

    const fromEast = draw({ x: 8, y: 2, z: 5 });
    expect(fromEast).toHaveLength(2);
    // mirrored: the shelf is now between the eye and the wall
    expect(fromEast[0]!.fill).toBe('#0f0');
    expect(fromEast[1]!.fill).toBe('#f0f');
  });

  it('emits every face exactly once — nothing disappears at any angle', () => {
    const bsp = buildSceneBSP([shelf, wall]);
    const draw = (eye: { x: number; y: number; z: number }) => {
      const out: Face[] = [];
      for (const { node } of bsp) traverseFaceBSP(node, eye, out);
      return out;
    };
    for (const eye of [{ x: 0, y: 2, z: 5 }, { x: 8, y: 2, z: 5 }, { x: 6, y: -5, z: 1 }]) {
      const out = draw(eye);
      const sig = out.map((f) => JSON.stringify(f.pts));
      expect(new Set(sig).size).toBe(sig.length); // no duplicate faces
      expect(out.filter((f) => f.fill === '#0f0')).toHaveLength(1);
      expect(out.filter((f) => f.fill === '#f0f')).toHaveLength(1);
    }
  });
});
    it('splits the floor slab and long walls into ≤4 m tiles', () => {
      const faces = buildSceneFaces(floor, [el('wall', 'rect', { x: 0, y: 0, w: 20, h: 0.4, rot: 0 })]);
      const floorTiles = faces.filter(
        (f) => !f.line && f.pts.length === 4 && f.pts.every((p) => p.z === 0) && f.fill === '#f5f3ec'
      );
      expect(floorTiles).toHaveLength(20); // 20×14 m → 5×4 tiles
      // wall box: top 20×0.4 → 5 tiles, two 20 m sides → 5 each, two ends → 1 each
      const wallFaces = faces.filter((f) => !f.line && f.pts.some((p) => p.z > 2));
      expect(wallFaces).toHaveLength(17);
    });

    it('leaves small vertical faces untouched', () => {
      const small = [{ pts: [{ x: 0, y: 0, z: 0 }, { x: 2, y: 0, z: 0 }, { x: 2, y: 0, z: 2 }, { x: 0, y: 0, z: 2 }], fill: '#fff' }];
      const out = subdivideFaces(small);
      expect(out).toHaveLength(1);
      expect(out[0]).toBe(small[0]);
    });

    it('gives small horizontal solid faces a fine depth split (smooth over-wall sliver)', () => {
      const top = [{ pts: [{ x: 0, y: 0, z: 1.5 }, { x: 4, y: 0, z: 1.5 }, { x: 4, y: 1.1, z: 1.5 }, { x: 0, y: 1.1, z: 1.5 }], fill: '#fff' }];
      const out = subdivideFaces(top);
      expect(out).toHaveLength(2); // 4 m along x → 1, 1.1 m depth → ceil(1.1/0.6) = 2
      const ys = out.flatMap((f) => f.pts.map((p) => p.y));
      expect(Math.max(...ys) - Math.min(...ys)).toBeCloseTo(1.1, 5);
    });

    it('tiles span the original quad exactly', () => {
      const quad = [
        { x: 0, y: 0, z: 0 }, { x: 12, y: 0, z: 0 }, { x: 12, y: 6, z: 0 }, { x: 0, y: 6, z: 0 },
      ];
      const out = subdivideFaces([{ pts: quad, fill: '#fff' }]);
      expect(out).toHaveLength(30); // 12 m → 3 along x; 6 m horizontal solid → 10 along depth
      const xs = out.flatMap((f) => f.pts.map((p) => p.x));
      const ys = out.flatMap((f) => f.pts.map((p) => p.y));
      expect(Math.min(...xs)).toBe(0);
      expect(Math.max(...xs)).toBe(12);
      expect(Math.min(...ys)).toBe(0);
      expect(Math.max(...ys)).toBe(6);
    });
});

describe('colors', () => {
  it('multiplies hex channels', () => {
    expect(shade('#ff0000', 0.5)).toBe('#800000');
    expect(shade('#3366cc', 1)).toBe('#3366cc');
  });
});

describe('map themes (modern default vs optional retro 2010s)', () => {
  it('modern stays the classic look: single-quad route, 5-face box', () => {
    expect(routeFaces([{ x: 2, y: 2 }, { x: 8, y: 2 }])).toHaveLength(1);
    const base = [{ x: 4, y: 4 }, { x: 8, y: 4 }, { x: 8, y: 7 }, { x: 4, y: 7 }];
    expect(boxFaces(base, 1.5, '#e7d5a8')).toHaveLength(5);
    // the default scene fill is unchanged (pinned by the tiling tests too)
    const faces = buildSceneFaces(floor, []);
    expect(faces[0]!.fill).toBe('#f5f3ec');
  });

  it('top faces read clearly brighter than every side — caps stay visible', () => {
    const lum = (hex: string) => {
      const n = parseInt(hex.slice(1), 16);
      return ((n >> 16) & 255) + ((n >> 8) & 255) + (n & 255);
    };
    for (const [name, color, theme] of [
      ['modern shelf', '#e7d5a8', MODERN_THEME],
      ['modern wall', '#4b5147', MODERN_THEME],
      ['retro shelf', '#e7d5a8', RETRO_THEME],
      ['retro wall', '#4b5147', RETRO_THEME],
    ] as const) {
      const faces = boxFaces([{ x: 4, y: 4 }, { x: 8, y: 4 }, { x: 8, y: 7 }, { x: 4, y: 7 }], 1.5, color, 1, theme);
      const topL = lum(faces[0]!.fill!);
      const maxSide = Math.max(...faces.slice(1).map((f) => lum(f.fill!)));
      // the cap must out-bright the brightest side by a clear margin — at
      // overview zoom the top band is only a few px tall and needs the
      // contrast to read as a surface at all
      expect(topL - maxSide, `${name}: top ${topL} vs side ${maxSide}`).toBeGreaterThan(50);
    }
  });

  it('cap is inset into the box so the BSP can strictly separate it from the sides', () => {
    // A cap that merely touches the side planes has no separating plane —
    // the BSP can order a side after it and paint over the cap (tops
    // vanishing / appearing below the front face). The ~1 cm inset keeps
    // the cap strictly inside every side plane.
    const faces = boxFaces([{ x: 0, y: 0 }, { x: 24, y: 0 }, { x: 24, y: 0.7 }, { x: 0, y: 0.7 }], 1.5, '#e7d5a8');
    const cap = faces[0]!;
    const ys = cap.pts.map((p) => p.y);
    const xs = cap.pts.map((p) => p.x);
    expect(Math.min(...ys)).toBeGreaterThan(0);
    expect(Math.max(...ys)).toBeLessThan(0.7);
    expect(Math.min(...xs)).toBeGreaterThan(0);
    expect(Math.max(...xs)).toBeLessThan(24);
    // still at full height, and still 4 corners
    expect(cap.pts.every((p) => p.z === 1.5)).toBe(true);
    expect(cap.pts).toHaveLength(4);
  });

  it('retro route adds a glossy highlight strip and dashes above the ribbon', () => {
    const faces = routeFaces([{ x: 2, y: 2 }, { x: 8, y: 2 }], RETRO_THEME);
    expect(faces.length).toBeGreaterThan(1);
    expect(faces.every((f) => f.layer === 1)).toBe(true);
    const zs = faces.map((f) => f.pts[0]!.z);
    expect(Math.min(...zs)).toBeCloseTo(ROUTE.z, 5); // base ribbon still at ROUTE.z
    expect(Math.max(...zs)).toBeGreaterThan(ROUTE.z); // gloss rides above it
  });

  it('retro two-tone splits every side quad into a sunlit band and a shaded base', () => {
    const base = [{ x: 4, y: 4 }, { x: 8, y: 4 }, { x: 8, y: 7 }, { x: 4, y: 7 }];
    const faces = boxFaces(base, 1.5, '#e7d5a8', 1, RETRO_THEME);
    expect(faces).toHaveLength(9); // top + 4 sides × 2 bands
    expect(faces[0].pts.every((p) => p.z === 1.5)).toBe(true); // top unchanged
  });

  it('retro theme keeps the modern scene face counts (shadows are composed by Map3D)', () => {
    const els = [el('wall', 'rect', { x: 0, y: 0, w: 20, h: 0.4, rot: 0 })];
    const modern = buildSceneFaces(floor, els);
    const retro = buildSceneFaces(floor, els, RETRO_THEME);
    // two-tone doubles the wall's side quads, so retro emits more — but the
    // floor/grid/decal counts (what the pinned tests check) must be identical
    const count = (fs: Face[], pred: (f: Face) => boolean) => fs.filter(pred).length;
    expect(count(retro, (f) => f.line === true)).toBe(count(modern, (f) => f.line === true));
    expect(count(retro, (f) => !f.line && f.layer === 0)).toBe(count(modern, (f) => !f.line && f.layer === 0));
  });

  it('contact shadows: one decal per solid rect, offset away from the light', () => {
    const faces = buildContactShadows([el('shelf', 'rect', { x: 4, y: 4, w: 3, h: 1, rot: 0 })], RETRO_THEME);
    expect(faces).toHaveLength(1);
    const f = faces[0]!;
    expect(f.layer).toBe(0.5);
    expect(f.pts.every((p) => p.z === 0.05)).toBe(true);
    expect((f.alpha ?? 1) < 1).toBe(true);
    // light comes from −x/−y, so the shadow center falls +x/+y of the fixture center (5.5, 4.5)
    const cx = f.pts.reduce((a, p) => a + p.x, 0) / f.pts.length;
    const cy = f.pts.reduce((a, p) => a + p.y, 0) / f.pts.length;
    expect(cx).toBeGreaterThan(5.5);
    expect(cy).toBeGreaterThan(4.5);
  });

  it('contact shadows skip decals and non-rect shapes', () => {
    const els = [el('zone', 'rect', { x: 2, y: 2, w: 5, h: 5, rot: 0 }), el('wall', 'polyline', [[0, 0], [4, 4]])];
    expect(buildContactShadows(els, RETRO_THEME)).toHaveLength(0);
  });
});

describe('fitCamera', () => {
  it('centers on the floor and frames its larger span', () => {
    const cam = fitCamera(floor);
    expect(cam.tx).toBeCloseTo(10);
    expect(cam.ty).toBeCloseTo(7);
    expect(cam.dist).toBeCloseTo(20 * 1.25);
    expect(cam.pitch).toBeGreaterThan(0);
    expect(cam.pitch).toBeLessThan(Math.PI / 2);
  });
});

describe('camFromEyeLook', () => {
  it('round-trips: the look-at point projects to the screen center at eye distance', () => {
    const eye = { x: 5, y: 12, z: 3 };
    const look = { x: 9, y: 8, z: 1 };
    const cam = camFromEyeLook(eye, look);
    const pr = project(cam, W, H, look)!;
    expect(pr.x).toBeCloseTo(W / 2, 3);
    expect(pr.y).toBeCloseTo(H / 2, 3);
    expect(pr.depth).toBeCloseTo(Math.hypot(4, 4, 2), 3);
  });

  it('looks straight down for an overhead eye', () => {
    const cam = camFromEyeLook({ x: 0, y: 0, z: 10 }, { x: 0, y: 0, z: 0 });
    expect(cam.pitch).toBeCloseTo(Math.PI / 2, 5);
    expect(cam.dist).toBeCloseTo(10);
  });
});

describe('pathSampler', () => {
  it('computes arc length and interpolates linearly', () => {
    const s = pathSampler([{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 5 }]);
    expect(s.total).toBeCloseTo(15);
    expect(s.at(5)).toEqual({ x: 5, y: 0 });
    expect(s.at(12)).toEqual({ x: 10, y: 2 });
  });

  it('extends straight beyond the ends along the end headings', () => {
    const s = pathSampler([{ x: 2, y: 0 }, { x: 5, y: 0 }]);
    expect(s.at(-1)).toEqual({ x: 1, y: 0 });
    expect(s.at(4)).toEqual({ x: 6, y: 0 });
  });

  it('heading follows segment directions', () => {
    const s = pathSampler([{ x: 0, y: 0 }, { x: 4, y: 0 }, { x: 4, y: 3 }]);
    expect(s.headingAt(1)).toEqual({ x: 1, y: 0 });
    expect(s.headingAt(5)).toEqual({ x: 0, y: 1 });
  });
});

describe('contact shadows', () => {
  it('are no longer generated — fixtures render clean on the floor', () => {
    const faces = buildSceneFaces(floor, [el('shelf', 'rect', { x: 4, y: 4, w: 3, h: 1, rot: 0 })]);
    expect(faces.every((f) => (f.alpha ?? 1) === 1 || f.fill === '#7fa986' || f.layer === 0)).toBe(true);
    expect(faces.some((f) => f.pts.every((p) => p.z === 0.02))).toBe(false);
  });
});

describe('near-plane clipping', () => {
  const cam = { yaw: 0, pitch: 0.5, dist: 3, tx: 10, ty: 7, tz: 0 };

  it('keeps the visible part of a face straddling the camera', () => {
    // wall running away from the camera: near end in front, far end behind
    const quad = [
      { x: 10.2, y: 9.5, z: 0 },  // depth ≈ 0.80 — in front of the near plane
      { x: 10.2, y: 10.5, z: 0 }, // depth ≈ −0.07 — behind
      { x: 10.8, y: 10.5, z: 2.5 },
      { x: 10.8, y: 9.5, z: 2.5 },
    ];
    const cams = quad.map((p) => toCamera(cam, p));
    expect(cams[0].depth).toBeGreaterThan(NEAR);
    expect(cams[1].depth).toBeLessThan(NEAR);
    const clipped = clipPolygonNear(cams);
    expect(clipped.length).toBeGreaterThanOrEqual(3);
    expect(clipped.every((c) => c.depth >= NEAR - 1e-9)).toBe(true);
    // the crossing point sits exactly on the near plane
    expect(clipped.some((c) => Math.abs(c.depth - NEAR) < 1e-9)).toBe(true);
  });

  it('drops faces entirely behind the camera', () => {
    const cams = [
      { x1: -1, up: 0, depth: -2 },
      { x1: 1, up: 0, depth: -1 },
      { x1: 1, up: 2, depth: -1 },
    ];
    expect(clipPolygonNear(cams)).toHaveLength(0);
  });

  it('stocking blocks stand on the outward face of a shelf', () => {
    const faces = stockFaces([{ x: 6, y: 6, nx: 0, ny: 1, color: '#3b6fd4' }]);
    const f = faces[0];
    // offset outward along +y, vertical extent 0.32..1.18
    expect(f.pts.every((p) => p.y > 6)).toBe(true);
    expect(Math.min(...f.pts.map((p) => p.z))).toBeCloseTo(0.32);
    expect(Math.max(...f.pts.map((p) => p.z))).toBeCloseTo(1.18);
  });

  it('keeps blocks on both faces of a shelf — the BSP hides whichever is behind', () => {
    const faces = stockFaces([
      { x: 6, y: 6, nx: 0, ny: 1, color: '#3b6fd4' },
      { x: 6, y: 6, nx: 0, ny: -1, color: '#2f9e44' },
    ]);
    expect(faces).toHaveLength(2);
  });
});
