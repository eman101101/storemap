import { render } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import GridHero, { BlockText, WORD, GRID_GLYPHS, buildBoard, findGridPath } from './GridHero';

describe('grid wordmark', () => {
  it('has a glyph for every letter of the word', () => {
    for (const ch of WORD) expect(GRID_GLYPHS[ch]).toBeTruthy();
  });

  it('lays the word out on the padded board', () => {
    const board = buildBoard(WORD);
    const filled = [...WORD].reduce(
      (n, ch) => n + GRID_GLYPHS[ch].join('').split('#').length - 1,
      0
    );
    expect(board.cells).toHaveLength(filled);
    const { cols, rows } = board;
    for (const p of board.cells) {
      expect(p.c).toBeGreaterThanOrEqual(0);
      expect(p.c).toBeLessThan(cols);
      expect(p.r).toBeGreaterThanOrEqual(0);
      expect(p.r).toBeLessThan(rows);
    }
    // the arrival spot is a letter cell — the route ends ON the name
    expect(board.blocked[board.target.r * cols + board.target.c]).toBe(1);
    // the entrance is a free cell in the bottom-left lane
    expect(board.blocked[board.entrance.r * cols + board.entrance.c]).toBe(0);
  });

  it('routes from the entrance to the name without crossing letter cells', () => {
    const board = buildBoard(WORD);
    const path = findGridPath(board, board.entrance, board.target);
    expect(path).not.toBeNull();
    expect(path![0]).toEqual(board.entrance);
    expect(path![path!.length - 1]).toEqual(board.target);
    for (let i = 1; i < path!.length; i++) {
      const d = Math.abs(path![i].c - path![i - 1].c) + Math.abs(path![i].r - path![i - 1].r);
      expect(d).toBe(1); // orthogonal steps only, like the real nav grid
    }
    const { cols } = board;
    for (const p of path!.slice(0, -1)) {
      expect(board.blocked[p.r * cols + p.c]).toBe(0);
    }
  });

  it('renders the board and, under reduced motion, the finished route', () => {
    // force the prefers-reduced-motion path: full route + lit destination, no loop
    vi.stubGlobal('matchMedia', vi.fn().mockReturnValue({ matches: true }));
    const { container } = render(<GridHero />);
    expect(container.querySelectorAll('.gh-cell')).toHaveLength(buildBoard(WORD).cells.length);
    const line = container.querySelector<SVGPathElement>('.route-line');
    expect(line).not.toBeNull();
    expect(line!.style.strokeDashoffset).toBe('0');
    // no pin icon — the destination block itself is lit red
    expect(container.querySelector('.gh-pin')).toBeNull();
    const target = container.querySelector<SVGRectElement>('.gh-target');
    expect(target).not.toBeNull();
    expect(target!.style.opacity).toBe('1');
  });

  it('offers five distinct arrival spots, each reachable without crossing letters', () => {
    const board = buildBoard(WORD);
    expect(board.targets).toHaveLength(5);
    expect(new Set(board.targets.map((p) => `${p.c},${p.r}`)).size).toBe(5);
    for (const spot of board.targets) {
      expect(board.blocked[spot.r * board.cols + spot.c]).toBe(1);
      const path = findGridPath(board, board.entrance, spot);
      expect(path).not.toBeNull();
      expect(path![path!.length - 1]).toEqual(spot);
    }
  });

  it('kerns the i and t one unit tighter than a full letter advance', () => {
    const board = buildBoard('it');
    // the i's dot column is MARGIN+2 = 6; the t crossbar's leftmost cell would
    // sit at column 10 with the default advance — kerning pulls it to 9
    expect(board.cells.some((p) => p.c === 6 && p.r === 4)).toBe(true); // the i dot
    const tMin = Math.min(...board.cells.filter((p) => p.c > 6).map((p) => p.c));
    expect(tMin).toBe(9);
  });

  it('BlockText lays out block letters and skips unknown characters', () => {
    const { container } = render(<BlockText text="a c?" />);
    const expected = ['a', 'c'].reduce(
      (n, ch) => n + GRID_GLYPHS[ch].join('').split('#').length - 1,
      0
    );
    expect(container.querySelectorAll('rect')).toHaveLength(expected);
  });

  it('routes to a fresh random spot on each loop pass', () => {
    // manual rAF pump — the loop is clock-driven, so feed frames by hand
    let pending = new Map<number, (now: number) => void>();
    let nextId = 1;
    let now = 0;
    vi.stubGlobal('matchMedia', vi.fn().mockReturnValue({ matches: false }));
    vi.stubGlobal('requestAnimationFrame', vi.fn().mockImplementation((cb: (n: number) => void) => {
      const id = nextId++;
      pending.set(id, cb);
      return id;
    }));
    vi.stubGlobal('cancelAnimationFrame', vi.fn().mockImplementation((id: number) => {
      pending.delete(id);
    }));
    // the five arrival spots in svg units: i-dot, m stem, period, l top, e bar
    const SPOTS = new Set(['65,45', '235,75', '285,105', '375,45', '535,85']);
    const endPoint = (container: HTMLElement) => {
      const d = container.querySelector('.route-line')!.getAttribute('d')!;
      return d.slice(d.lastIndexOf('L') + 1).replace(' ', ',');
    };

    const { container } = render(<GridHero />);
    const end0 = endPoint(container);
    expect(SPOTS.has(end0)).toBe(true); // the initial route ends on a spot

    // pump ~11.5s: wave → walk → hold → fade → gap wraps into a new pass
    for (let i = 0; i < 720; i++) {
      now += 16;
      const [id, cb] = [...pending.entries()][0] ?? [];
      if (id != null) {
        pending.delete(id);
        cb(now);
      }
    }
    const end1 = endPoint(container);
    expect(SPOTS.has(end1)).toBe(true); // the swapped route still ends on a spot
    expect(end1).not.toBe(end0); // …a different one from the pass before
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });
});
