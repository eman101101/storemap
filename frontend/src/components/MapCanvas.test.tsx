/** Regression tests for editor-canvas keyboard interactions. */
import { describe, it, expect, vi, beforeAll } from 'vitest';
import { useState } from 'react';
import { render, fireEvent, act } from '@testing-library/react';
import MapCanvas from './MapCanvas';
import { parseElement } from '../types';
import type { Floor, MapElement } from '../types';

// jsdom has no ResizeObserver — MapCanvas sizes itself with one
beforeAll(() => {
  globalThis.ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  } as unknown as typeof ResizeObserver;
});

const floor: Floor = {
  id: 'f1', store_id: 's1', name: 'Main', level: 0, width_m: 20, height_m: 14, background_url: '',
};

const el = (id: string, x: number): MapElement =>
  parseElement({
    id, floor_id: 'f1', type: 'shelf', shape: 'rect',
    geometry: JSON.stringify({ x, y: 4, w: 2, h: 1, rot: 0 }),
    label: '', color: '', meta: '{}', z_index: 0,
  });

describe('MapCanvas keyboard (multi-select)', () => {
  it('Delete acts on the multi-selection after it changes — no stale closure', () => {
    const elements = [el('a', 2), el('b', 6)];
    const onElementsChange = vi.fn();
    let select: ((ids: Set<string>) => void) | null = null;
    const Host = () => {
      const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
      select = setSelectedIds;
      return (
        <MapCanvas
          floor={floor}
          elements={elements}
          pins={[]}
          viewport={{ scale: 10, tx: 0, ty: 0 }}
          onViewport={() => {}}
          edit
          tool="select"
          selectedIds={selectedIds}
          onMultiSelect={setSelectedIds}
          onElementsChange={onElementsChange}
        />
      );
    };
    render(<Host />);
    // a shift-click populated the multi-selection: ONLY selectedIds changed —
    // the keydown effect must have picked the new set up (its deps used to
    // omit selectedIds, so Delete ran the pre-multi-select closure)
    act(() => select!(new Set(['a', 'b'])));
    fireEvent.keyDown(window, { key: 'Delete' });
    expect(onElementsChange).toHaveBeenCalledTimes(1);
    expect(onElementsChange.mock.calls[0]![0]).toEqual([]);
    expect(onElementsChange.mock.calls[0]![1]).toBe('push');
  });
});
