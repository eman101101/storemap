/** Tests for the lightweight 3D renderer — projection, mesh building, colors. */
import { describe, it, expect } from 'vitest';
import type { Floor, MapElement } from '../types';
import type { StockItem } from './render3d';
import {
  project, fitCamera, boxFaces, routeFaces, buildSceneFaces, scaleColor, ROUTE, pickFixture,
  camFromEyeLook, pathSampler, toCamera, clipPolygonNear, stockFaces, subdivideFaces,
  buildSceneBSP, traverseFaceBSP, MODERN_THEME, DARK_THEME, NEAR,
  screenToWorldFloor, elementHeight, shelfFaces, shelfDetailForDist, SHELF_LOD, DIST_MIN, DIST_MAX, distMaxFor,
  type Face, type Camera3D,
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
    expect(side.pts.some((p) => p.z > 1.49)).toBe(true); // walls reach (almost) the cap
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
    expect(scaleColor('#ff0000', 0.5)).toBe('#800000');
    expect(scaleColor('#3366cc', 1)).toBe('#3366cc');
  });
});

describe('map themes (light default + dark)', () => {
  it('light stays the classic look: single-quad route, 5-face box', () => {
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
      ['light shelf', '#e7d5a8', MODERN_THEME],
      ['light wall', '#4b5147', MODERN_THEME],
      ['dark shelf', '#e7d5a8', DARK_THEME],
      ['dark wall', '#4b5147', DARK_THEME],
    ] as const) {
      const faces = boxFaces([{ x: 4, y: 4 }, { x: 8, y: 4 }, { x: 8, y: 7 }, { x: 4, y: 7 }], 1.5, color, 1, theme);
      const topL = lum(faces[0]!.fill!);
      const maxSide = Math.max(...faces.slice(1).map((f) => lum(f.fill!)));
      // the cap must out-bright the brightest side by a clear margin — at
      // overview zoom the top band is only a few px tall and needs the
      // contrast to read as a surface at all
      expect(topL - maxSide, `${name}: top ${topL} vs side ${maxSide}`).toBeGreaterThan(40);
    }
  });

  it('dark theme dims fixtures and repaints the backdrop', () => {
    const faces = buildSceneFaces(floor, [el('shelf', 'rect', { x: 4, y: 4, w: 3, h: 1, rot: 0 })], DARK_THEME);
    expect(faces[0]!.fill).toBe(DARK_THEME.floorFill);
    const lum = (hex: string) => {
      const n = parseInt(hex.slice(1), 16);
      return ((n >> 16) & 255) + ((n >> 8) & 255) + (n & 255);
    };
    const shelfFill = faces.find((f) => !f.line && f.pts.some((p) => p.z === 1.5))!.fill!;
    const lightShelf = boxFaces([{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 1, y: 1 }, { x: 0, y: 1 }], 1.5, '#e7d5a8')[0]!.fill!;
    expect(lum(shelfFill)).toBeLessThan(lum(lightShelf)); // fixtureShade dims the palette
  });

  it('dark theme keeps the light scene face counts (structure is theme-independent)', () => {
    const els = [el('wall', 'rect', { x: 0, y: 0, w: 20, h: 0.4, rot: 0 })];
    const light = buildSceneFaces(floor, els);
    const dark = buildSceneFaces(floor, els, DARK_THEME);
    expect(dark.filter((f) => f.line === true)).toHaveLength(light.filter((f) => f.line === true).length);
    expect(dark.filter((f) => !f.line && f.layer === 0)).toHaveLength(light.filter((f) => !f.line && f.layer === 0).length);
  });

  it('walls stop just below the full-size cap so the BSP can strictly separate them', () => {
    // A cap that merely touches the walls' top edges has no separating plane —
    // the BSP can order a wall after it and paint over the cap. Walls a hair
    // SHORTER make cap-vs-walls strictly separable in z with zero visible gap.
    const faces = boxFaces([{ x: 0, y: 0 }, { x: 24, y: 0 }, { x: 24, y: 0.7 }, { x: 0, y: 0.7 }], 1.5, '#e7d5a8');
    const cap = faces[0]!;
    const ys = cap.pts.map((p) => p.y);
    const xs = cap.pts.map((p) => p.x);
    expect(Math.min(...ys)).toBeCloseTo(0, 5);
    expect(Math.max(...ys)).toBeCloseTo(0.7, 5);
    expect(Math.min(...xs)).toBeCloseTo(0, 5);
    expect(Math.max(...xs)).toBeCloseTo(24, 5);
    expect(cap.pts.every((p) => p.z === 1.5)).toBe(true);
    for (const f of faces.slice(1)) {
      expect(Math.max(...f.pts.map((p) => p.z))).toBeLessThan(1.5);
      expect(Math.max(...f.pts.map((p) => p.z))).toBeGreaterThan(1.49);
    }
  });

  it('depth-capped leaves fall back to back-to-front centroid order', () => {
    const leaf = {
      axis: 0 as const,
      split: 0,
      below: null,
      above: null,
      faces: [
        { pts: [{ x: 0, y: 0, z: 0 }, { x: 1, y: 0, z: 0 }, { x: 1, y: 1, z: 0 }, { x: 0, y: 1, z: 0 }], fill: '#near' },
        { pts: [{ x: 9, y: 9, z: 0 }, { x: 10, y: 9, z: 0 }, { x: 10, y: 10, z: 0 }, { x: 9, y: 10, z: 0 }], fill: '#far' },
        { pts: [{ x: 4, y: 4, z: 0 }, { x: 5, y: 4, z: 0 }, { x: 5, y: 5, z: 0 }, { x: 4, y: 5, z: 0 }], fill: '#mid' },
      ],
    };
    const out: Face[] = [];
    traverseFaceBSP(leaf, { x: -10, y: -10, z: 10 }, out);
    expect(out.map((f) => f.fill)).toEqual(['#far', '#mid', '#near']);
  });
});

describe('fitCamera', () => {
  it('centers on the floor and frames its larger span', () => {
    const cam = fitCamera(floor);
    expect(cam.tx).toBeCloseTo(10);
    expect(cam.ty).toBeCloseTo(7 + 20 * 0.05); // nudged up a little
    expect(cam.dist).toBeCloseTo(20 * 1.25);
    expect(cam.pitch).toBeGreaterThan(0);
    expect(cam.pitch).toBeLessThan(Math.PI / 2);
  });

  /** Whether every corner of the floor lands inside a `w × h` canvas. */
  const floorFits = (cam: ReturnType<typeof fitCamera>, fl: typeof floor, w: number, h: number) => {
    for (const x of [0, fl.width_m]) {
      for (const y of [0, fl.height_m]) {
        const p = project(cam, w, h, { x, y, z: 0 });
        if (!p || p.x < 0 || p.x > w || p.y < 0 || p.y > h) return false;
      }
    }
    return true;
  };

  it('leaves a wide canvas exactly where it was', () => {
    expect(fitCamera(floor, 16 / 9)).toEqual(fitCamera(floor));
    expect(fitCamera(floor, 2.5)).toEqual(fitCamera(floor));
  });

  it('backs the eye up until the whole floor fits a narrow canvas', () => {
    // the big-box example floor on a portrait phone, a portrait tablet, and
    // the homepage hero's box on a phone
    const big = { ...floor, width_m: 96, height_m: 62 };
    for (const [w, h] of [[390, 844], [320, 568], [768, 1024], [342, 444]]) {
      expect(floorFits(fitCamera(big), big, w, h), `${w}×${h}: the shape-blind camera`).toBe(false);
      const cam = fitCamera(big, w / h);
      expect(floorFits(cam, big, w, h), `${w}×${h}`).toBe(true);
      expect(cam.dist, `${w}×${h}: farther than the default`).toBeGreaterThan(fitCamera(big).dist);
    }
  });

  /** Whether every corner of the floor lands between the canvas's left and right edges. */
  const floorFitsWidth = (cam: ReturnType<typeof fitCamera>, fl: typeof floor, w: number, h: number) =>
    [0, fl.width_m].every((x) => [0, fl.height_m].every((y) => {
      const p = project(cam, w, h, { x, y, z: 0 });
      return !!p && p.x >= 0 && p.x <= w;
    }));

  it('frames closer on request — but a closer view never crops the floor\'s sides', () => {
    const big = { ...floor, width_m: 96, height_m: 62 };
    for (const [w, h] of [[1280, 374], [390, 460], [342, 300], [768, 460]]) {
      const closer = fitCamera(big, w / h, 0.7);
      expect(closer.dist, `${w}×${h}`).toBeLessThanOrEqual(fitCamera(big, w / h).dist);
      expect(floorFitsWidth(closer, big, w, h), `${w}×${h}`).toBe(true);
    }
    // on a wide box the closer view is simply 30% nearer than the full fit
    expect(fitCamera(big, 2.5, 0.7).dist).toBeCloseTo(fitCamera(big, 2.5).dist * 0.7);
  });

  it('only backs up — the narrower the canvas, the farther the eye, never the reverse', () => {
    const base = fitCamera(floor).dist;
    let prev = base;
    for (const aspect of [3, 2.5, 2, 1.5, 1, 0.75, 0.5]) {
      const d = fitCamera(floor, aspect).dist;
      expect(d, `aspect ${aspect}`).toBeGreaterThanOrEqual(base - 1e-9);
      expect(d, `aspect ${aspect}`).toBeGreaterThanOrEqual(prev - 1e-9);
      prev = d;
    }
  });

  it('always leaves the camera inside the range its own zoom clamps to', () => {
    // a portrait phone, a tablet, a desktop window — and floors from a corner
    // shop to something far larger than any real store
    for (const [w, h] of [[320, 568], [390, 844], [768, 1024], [1280, 860]]) {
      for (const [fw, fh] of [[12, 12], [40, 30], [96, 62], [200, 140], [400, 280]]) {
        const fl = { ...floor, width_m: fw, height_m: fh };
        const dist = fitCamera(fl, w / h).dist;
        const max = distMaxFor(fl, w / h);
        expect(max, `${w}×${h}, ${fw}×${fh} m`).toBeGreaterThanOrEqual(dist);
        // and the ＋/− glide from a fitted view is exactly one zoom step, not a snap
        expect(Math.min(max, Math.max(DIST_MIN, dist / 1.3)), `${w}×${h}, ${fw}×${fh} m`).toBeCloseTo(dist / 1.3);
      }
    }
  });

  it('keeps the usual zoom-out ceiling wherever the fit never reaches it', () => {
    // a small floor fits inside 160 m on any canvas; the big-box floor only
    // outgrows it once the canvas is portrait
    const big = { ...floor, width_m: 96, height_m: 62 };
    expect(distMaxFor(floor)).toBe(DIST_MAX);
    expect(distMaxFor(floor, 0.5)).toBe(DIST_MAX);
    expect(distMaxFor(big, 16 / 9)).toBe(DIST_MAX);
    expect(distMaxFor(big, 390 / 844)).toBeCloseTo(fitCamera(big, 390 / 844).dist);
    expect(distMaxFor(big, 390 / 844)).toBeGreaterThan(DIST_MAX);
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

describe('near-plane clipping', () => {  const cam = { yaw: 0, pitch: 0.5, dist: 3, tx: 10, ty: 7, tz: 0 };

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

  it('a pinned product is four item squares stacked up the shelf face', () => {
    const faces = stockFaces([{ x: 6, y: 6, nx: 0, ny: 1, color: '#3b6fd4' }]);
    expect(faces).toHaveLength(4); // one per shelf level
    for (const f of faces) {
      expect(f.pts.every((p) => p.y > 6)).toBe(true); // offset outward along +y
      expect(Math.max(...f.pts.map((p) => p.z)) - Math.min(...f.pts.map((p) => p.z))).toBeCloseTo(0.24); // item height
    }
    const bottoms = faces.map((f) => Math.min(...f.pts.map((p) => p.z))).sort((a, b) => a - b);
    expect(bottoms[0]).toBeCloseTo(0.28); // lowest level
    expect(bottoms[3]).toBeCloseTo(1.18); // highest level
  });

  it('stock-heavy scenes keep exact ordering — far shelf draws before near shelf from any side', () => {
    // two facing gondola shelves, each with 30 pinned products (4 squares each)
    const shelfA = { x: 10, y: 10, w: 20, h: 0.7, rot: 0 };
    const shelfB = { x: 10, y: 14, w: 20, h: 0.7, rot: 0 };
    const els = [
      { ...el('shelf', 'rect', shelfA), id: 'a' },
      { ...el('shelf', 'rect', shelfB), id: 'b' },
    ];
    const floor = { id: 'f', store_id: 's', name: '', level: 0, width_m: 40, height_m: 30, background_url: '' };
    const scene = buildSceneFaces(floor, els);
    const stock: StockItem[] = [];
    for (let i = 0; i < 30; i++) {
      stock.push({ x: 11 + i * 0.6, y: 10.7, nx: 0, ny: 1, color: '#3b6fd4' }); // A's south face
      stock.push({ x: 11 + i * 0.6, y: 14, nx: 0, ny: -1, color: '#2f9e44' }); // B's north face
    }
    const bsp = buildSceneBSP([...scene, ...stockFaces(stock)]);
    const ordered: Face[] = [];
    for (const { node } of bsp) traverseFaceBSP(node, { x: 20, y: 5, z: 30 }, ordered); // eye south of both
    // every face belonging to shelf B (farther) must be drawn before any face of shelf A,
    // and no stock face may come after shelf A's south wall (it would bleed through)
    // draw order is farthest-first: every shelf-B face (far) must precede
    // every shelf-A face (near), or A's wall would fail to hide B's stock
    // shelf geometry only — grid lines and floor tiles sit at z=0 and never occlude
    const shelfFace = (f: Face) => f.pts.some((p) => p.z > 0.5);
    const firstA = Math.min(
      ...ordered.map((f, i) => (shelfFace(f) && f.pts.every((p) => p.y <= 10.75) ? i : Infinity))
    );
    const lastB = Math.max(
      ...ordered.map((f, i) => (shelfFace(f) && f.pts.every((p) => p.y >= 13.95) ? i : -1))
    );
    expect(firstA).toBeGreaterThan(lastB);
  });

  it('items on both faces of a shelf coexist — the BSP hides whichever is behind', () => {
    const faces = stockFaces([
      { x: 6, y: 6, nx: 0, ny: 1, color: '#3b6fd4' },
      { x: 6, y: 6, nx: 0, ny: -1, color: '#2f9e44' },
    ]);
    expect(faces).toHaveLength(8); // four squares per item, two items
    expect(faces.slice(0, 4).every((f) => f.pts.every((p) => p.y > 6))).toBe(true);
    expect(faces.slice(4).every((f) => f.pts.every((p) => p.y < 6))).toBe(true);
  });
});

describe('screenToWorldFloor (3D edit-drag unprojection)', () => {
  const W = 1280;
  const H = 720;
  const cams: [string, Camera3D][] = [
    ['default', fitCamera(floor)],
    ['yaw 0', { ...fitCamera(floor), yaw: 0 }],
    ['from west', { ...fitCamera(floor), yaw: Math.PI / 2 }],
    ['low pitch 0.3', { ...fitCamera(floor), pitch: 0.3 }],
    ['close-in', { yaw: -0.3, pitch: 0.7, dist: 12, tx: 15, ty: 20, tz: 0 }],
  ];

  for (const [name, cam] of cams) {
    it(`round-trips world → screen → world (${name})`, () => {
      for (const p of [{ x: 5, y: 5 }, { x: 24, y: 23 }, { x: 20, y: 12 }, { x: 12, y: 30 }]) {
        const s = project(cam, W, H, { x: p.x, y: p.y, z: 0 });
        if (!s) continue; // behind camera at this angle — unprojection is moot
        const back = screenToWorldFloor(cam, W, H, s.x, s.y)!;
        expect(back.x, `${name} @${p.x},${p.y}`).toBeCloseTo(p.x, 3);
        expect(back.y, `${name} @${p.x},${p.y}`).toBeCloseTo(p.y, 3);
      }
    });
  }

  it('returns null for pixels above the horizon (ray never meets the floor)', () => {
    // horizon lands on-screen only when pitch + fov/2 < 90°
    const cam = { ...fitCamera(floor), pitch: 0.4 }; // top-edge ray: -25°+25° ≈ horizon
    expect(screenToWorldFloor(cam, W, H, W / 2, 2)).toBeNull();
    // and a ground pixel still resolves at the same pitch
    expect(screenToWorldFloor(cam, W, H, W / 2, H - 4)).not.toBeNull();
  });
});

describe('pickFixture (ray picking — nearest hit wins)', () => {
  const W = 1280;
  const H = 720;
  let elementsOf: MapElement[] = [];
  const at = (cam: Camera3D, p: { x: number; y: number; z: number }) => {
    const s = project(cam, W, H, p)!;
    return pickFixture(cam, W, H, s.x, s.y, elementsOf);
  };

  // regression: the hull/mean-depth picker let the building-spanning outer
  // wall swallow every click — ray picking must prefer what the ray hits first
  it('picks the shelf through its front face, not the wall behind it', () => {
    elementsOf = [
      el('wall', 'polyline', [[9, 9], [21, 9]]),
      el('shelf', 'rect', { x: 10, y: 10, w: 12, h: 0.7, rot: 0 }),
    ];
    const picked = at(fitCamera(floor), { x: 16, y: 10.7, z: 0.4 });
    expect(picked!.elementId).toBe(elementsOf[1]!.id);
  });

  it('picks the wall itself when clicked away from other fixtures', () => {
    elementsOf = [
      el('wall', 'polyline', [[9, 9], [21, 9]]),
      el('shelf', 'rect', { x: 10, y: 10, w: 12, h: 0.7, rot: 0 }),
    ];
    const cam = fitCamera(floor);
    const s = project(cam, W, H, { x: 15, y: 9, z: 2.0 })!; // upper wall body
    const picked = pickFixture(cam, W, H, s.x, s.y, elementsOf);
    expect(picked!.elementId).toBe(elementsOf[0]!.id);
  });

  it('occlusion: a nearer shelf wins over a shelf behind it at low camera', () => {
    elementsOf = [
      el('shelf', 'rect', { x: 4, y: 20, w: 18, h: 0.7, rot: 0 }),   // far row (A)
      el('shelf', 'rect', { x: 11, y: 25, w: 3, h: 0.7, rot: 0 }),   // near row (B)
    ];
    const cam = { yaw: -0.62, pitch: 0.18, dist: 8, tx: 16, ty: 20, tz: 0 };
    // ray through the FAR row's face where the NEAR row blocks it
    const blocked = at(cam, { x: 13, y: 20.7, z: 0.75 });
    expect(blocked!.elementId).toBe(elementsOf[1]!.id);
    // ray through the far row where the near row doesn't cover it
    const clear = at(cam, { x: 5, y: 20.7, z: 0.75 });
    expect(clear!.elementId).toBe(elementsOf[0]!.id);
  });

  it('a point marker between the camera and a fixture wins the pick (units: t vs depth)', () => {
    // the marker's head (z=2) sits between the eye and the wall behind it:
    // the wall's prism hit must be converted from ray parameter (unnormalized
    // dir, length ≈ focal length in px) to meters before comparing depths —
    // raw parameters (~0.03) always beat the marker's depth (~18 m).
    // (yaw ≠ 0 keeps the ray from running parallel to the wall's end planes)
    elementsOf = [
      el('wall', 'polyline', [[4, 5], [16, 5]]),
      el('entrance', 'point', { x: 10, y: 8 }),
    ];
    const cam: Camera3D = { yaw: 0.3, pitch: 0.6, dist: 20, tx: 10, ty: 7, tz: 0 };
    const s = project(cam, W, H, { x: 10, y: 8, z: 2.0 })!;
    const picked = pickFixture(cam, W, H, s.x, s.y, elementsOf);
    expect(picked!.elementId).toBe(elementsOf[1]!.id);
  });

  it('point elements pick around their marker head', () => {
    elementsOf = [el('entrance', 'point', { x: 20, y: 19 })];
    const cam = fitCamera(floor);
    const s = project(cam, W, H, { x: 20, y: 19, z: 2.0 })!;
    const picked = pickFixture(cam, W, H, s.x + 5, s.y, elementsOf);
    expect(picked!.elementId).toBe(elementsOf[0]!.id);
  });

  it('returns null when the ray misses everything or points at the sky', () => {
    elementsOf = [el('shelf', 'rect', { x: 10, y: 10, w: 12, h: 0.7, rot: 0 })];
    const cam = fitCamera(floor);
    const far = pickFixture(cam, W, H, 10, 10, elementsOf);
    expect(far).toBeNull();
    const sky = pickFixture({ ...fitCamera(floor), pitch: 0.4 }, W, H, W / 2, 2, elementsOf);
    expect(sky).toBeNull();
  });
});

describe('elementHeight (meta.height override)', () => {
  it('defaults per type', () => {
    expect(elementHeight(el('shelf', 'rect', { x: 0, y: 0, w: 2, h: 1, rot: 0 }))).toBeCloseTo(1.5);
    expect(elementHeight(el('wall', 'rect', { x: 0, y: 0, w: 2, h: 0.2, rot: 0 }))).toBeCloseTo(3.2);
    expect(elementHeight(el('zone', 'rect', { x: 0, y: 0, w: 2, h: 1, rot: 0 }))).toBeCloseTo(0.06);
  });
  it('meta.height overrides, clamped to 0.3–3 m', () => {
    const base = el('shelf', 'rect', { x: 0, y: 0, w: 2, h: 1, rot: 0 });
    expect(elementHeight({ ...base, meta: '{"height":2.4}' })).toBeCloseTo(2.4);
    expect(elementHeight({ ...base, meta: '{"height":9}' })).toBeCloseTo(3);
    expect(elementHeight({ ...base, meta: '{"height":0.05}' })).toBeCloseTo(0.3);
  });
});

describe('shelfFaces — painted rows', () => {
  const corners = [
    { x: 0, y: 0 },
    { x: 3, y: 0 },
    { x: 3, y: 1 },
    { x: 0, y: 1 },
  ];
  const thinBands = (faces: Face[]) =>
    faces.filter((f) => {
      if (f.pts.length !== 4) return false;
      const zs = f.pts.map((p) => p.z);
      const extent = Math.max(...zs) - Math.min(...zs);
      return extent > 0 && extent <= 0.15;
    });

  it('adds a plinth band + one shadow strip per row on each long face', () => {
    expect(shelfFaces(corners, 1.5, '#c8b89a', 4)).toHaveLength(5 + 2 * (1 + 4));
    expect(shelfFaces(corners, 1.5, '#c8b89a', 1)).toHaveLength(5 + 2 * (1 + 1));
    expect(shelfFaces(corners, 1.5, '#c8b89a', 8)).toHaveLength(5 + 2 * (1 + 8));
    expect(thinBands(shelfFaces(corners, 1.5, '#c8b89a', 4))).toHaveLength(2 * (1 + 4));
  });
  it('below the minimum fixture height it stays a plain box', () => {
    expect(shelfFaces(corners, 0.2, '#c8b89a', 4)).toHaveLength(5);
  });
  it('end caps stay solid — only the long faces get bands', () => {
    const faces = shelfFaces(corners, 1.5, '#c8b89a', 2);
    // bands hug the two 3 m edges (y≈0 and y≈1, ± the 3 mm outward offset);
    // the 1 m end caps carry none
    const bands = thinBands(faces);
    expect(bands).toHaveLength(2 * (1 + 2));
    expect(bands.every((f) => f.pts.every((p) => Math.abs(p.y) < 0.01 || Math.abs(p.y - 1) < 0.01))).toBe(true);
  });
  it('buildSceneFaces paints rows from shelf meta', () => {
    const s = { ...el('shelf', 'rect', { x: 4, y: 4, w: 3, h: 1, rot: 0 }), meta: '{"levels":2,"height":2}' };
    const faces = buildSceneFaces(floor, [s]);
    expect(thinBands(faces)).toHaveLength(2 * (1 + 2));
    expect(Math.max(...faces.flatMap((f) => f.pts.map((p) => p.z)))).toBeCloseTo(2);
  });
});

describe('shelf-detail LOD (camera distance + hysteresis)', () => {
  it('flips to solid past the far threshold and back below the near one', () => {
    expect(shelfDetailForDist(SHELF_LOD.solidBeyond + 1, 'full')).toBe('solid');
    expect(shelfDetailForDist(SHELF_LOD.fullBelow - 1, 'solid')).toBe('full');
  });
  it('holds the current level anywhere in the band — no flapping', () => {
    const mid = (SHELF_LOD.solidBeyond + SHELF_LOD.fullBelow) / 2;
    expect(shelfDetailForDist(mid, 'full')).toBe('full');
    expect(shelfDetailForDist(mid, 'solid')).toBe('solid');
    // drifting back up near the far threshold, an already-solid camera stays solid
    expect(shelfDetailForDist(SHELF_LOD.solidBeyond - 1, 'solid')).toBe('solid');
    // and a full camera near the near threshold stays full
    expect(shelfDetailForDist(SHELF_LOD.fullBelow + 1, 'full')).toBe('full');
  });
  it('buildSceneFaces with shelfDetail "solid" drops the bands; non-shelves are unchanged', () => {
    const shelf = el('shelf', 'rect', { x: 4, y: 4, w: 3, h: 1, rot: 0 });
    const thinBands = (faces: Face[]) =>
      faces.filter((f) => {
        if (f.pts.length !== 4) return false;
        const zs = f.pts.map((p) => p.z);
        const extent = Math.max(...zs) - Math.min(...zs);
        return extent > 0 && extent <= 0.15;
      });
    const full = buildSceneFaces(floor, [shelf]);
    const solid = buildSceneFaces(floor, [shelf], MODERN_THEME, { shelfDetail: 'solid' });
    expect(solid.length).toBeLessThan(full.length);
    // default 4 rows: plinth + one shadow strip per row, on both long faces
    expect(thinBands(full)).toHaveLength(2 * (1 + 4));
    expect(thinBands(solid)).toHaveLength(0);
    const wall = el('wall', 'polyline', [[2, 2], [6, 2]]);
    expect(buildSceneFaces(floor, [wall], MODERN_THEME, { shelfDetail: 'solid' }))
      .toEqual(buildSceneFaces(floor, [wall]));
  });
});

describe('stockFaces — per-shelf boards and item size', () => {
  it('stands one facing per board at the given size', () => {
    const faces = stockFaces([{ x: 6, y: 6, nx: 0, ny: 1, color: '#3b6fd4', zs: [0.4, 0.9], h: 0.3, w: 0.4 }]);
    expect(faces).toHaveLength(2);
    const first = faces[0]!.pts.map((p) => p.z);
    expect(Math.min(...first)).toBeCloseTo(0.4);
    expect(Math.max(...first)).toBeCloseTo(0.7);
    // length 0.4 m along the shelf: x spans 5.8..6.2 at nx=0, ny=1
    const xs = faces[0]!.pts.map((p) => p.x);
    expect(Math.min(...xs)).toBeCloseTo(5.8);
    expect(Math.max(...xs)).toBeCloseTo(6.2);
  });
  it('without shelf data it falls back to the classic 4-level ladder', () => {
    expect(stockFaces([{ x: 6, y: 6, nx: 0, ny: 1, color: '#3b6fd4' }])).toHaveLength(4);
  });
});
