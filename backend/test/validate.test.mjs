/** Pure unit tests for the element validator — the core of map integrity. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { validateElement, str, num } from '../src/lib/validate.js';

test('valid rect shelf normalises rotation into [0,360)', () => {
  const row = validateElement({ type: 'shelf', shape: 'rect', geometry: { x: 1, y: 2, w: 4, h: 1.2, rot: 450 }, label: 'A1', color: '#aabbcc', z_index: 3.7 });
  assert.ok(row);
  const geo = JSON.parse(row.geometry);
  assert.equal(geo.rot, 90);
  assert.equal(row.z_index, 3);
  assert.equal(row.color, '#aabbcc');
});

test('negative rotation wraps', () => {
  const geo = JSON.parse(validateElement({ type: 'wall', shape: 'rect', geometry: { x: 0, y: 0, w: 1, h: 1, rot: -90 } }).geometry);
  assert.equal(geo.rot, 270);
});

test('invalid payloads are rejected', () => {
  const bad = [
    { type: 'shelf', shape: 'rect', geometry: { x: 0, y: 0, w: -1, h: 1 } },
    { type: 'shelf', shape: 'rect', geometry: { x: 0, y: 0, w: 1, h: 1 }, color: 'red', expectColor: '' },
    { type: 'entrance', shape: 'rect', geometry: { x: 0, y: 0, w: 1, h: 1, rot: 0 } },
    { type: 'point-type', shape: 'point', geometry: { x: 0, y: 0 } },
    { type: 'aisle', shape: 'polyline', geometry: [[0, 0]] },
    { type: 'aisle', shape: 'polyline', geometry: 'not-an-array' },
    { type: 'zone', shape: 'polygon', geometry: [[0, 0], [1, 'x']] },
    null,
    'nope',
  ];
  for (const b of bad) {
    const row = validateElement(b);
    if (b && b.expectColor !== undefined) {
      assert.ok(row, JSON.stringify(b));
      assert.equal(row.color, b.expectColor, 'invalid color normalises to empty');
    } else {
      assert.equal(row, null, JSON.stringify(b));
    }
  }
});

test('geometry passed as JSON string is accepted', () => {
  const row = validateElement({ type: 'entrance', shape: 'point', geometry: '{"x":3,"y":4}' });
  assert.deepEqual(JSON.parse(row.geometry), { x: 3, y: 4 });
});

test('str/num coercion', () => {
  assert.equal(str('  hi  '), 'hi');
  assert.equal(str(42), undefined);
  assert.equal(str(null), '');
  assert.equal(str(null, { allowEmpty: false }), null);
  assert.equal(num('3.5'), 3.5);
  assert.equal(num('x'), undefined);
});
