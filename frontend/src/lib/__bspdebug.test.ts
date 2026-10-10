import { describe, it } from 'vitest';
import { buildSceneBSP, traverseFaceBSP, toCamera } from './render3d';
import type { Face } from './render3d';

describe('debug', () => {
  it('dumps', () => {
    const wall: Face = {
      pts: [{ x: 5, y: 0, z: 0 }, { x: 5, y: 4, z: 0 }, { x: 5, y: 4, z: 3 }, { x: 5, y: 0, z: 3 }],
      fill: '#0f0', layer: 2,
    };
    const shelf: Face = {
      pts: [{ x: 6, y: 0, z: 1.5 }, { x: 7, y: 0, z: 1.5 }, { x: 7, y: 2, z: 1.5 }, { x: 6, y: 2, z: 1.5 }],
      fill: '#f0f', layer: 2,
    };
    const bsp = buildSceneBSP([shelf, wall]);
    const dump = (n: any, d: number): string =>
      n ? `N(a=${n.axis.toFixed(1)},s=${n.split.toFixed(2)},f=${n.faces.length}, {${n.faces.map((f: Face) => f.fill).join(',')}}; ${dump(n.below, 0)} | ${dump(n.above, 0)})` : '_';
    for (const { layer, node } of bsp) {
      console.log(`layer ${layer}: ${dump(node, 0)}`);
    }
    const out: Face[] = [];
    for (const { node } of bsp) traverseFaceBSP(node, { x: 0, y: 2, z: 5 }, out);
    console.log('west:', out.map(f => `${f.fill}[x:${f.pts.map(p => p.x).join(',')}]`).join(' -> '));
    const out2: Face[] = [];
    for (const { node } of bsp) traverseFaceBSP(node, { x: 8, y: 2, z: 5 }, out2);
    console.log('east:', out2.map(f => `${f.fill}[x:${f.pts.map(p => p.x).join(',')}]`).join(' -> '));
    void toCamera;
  });
});
