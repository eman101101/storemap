import { render } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import GridHero, { WORD, GRID_GLYPHS, buildBoard, findGridPath } from './GridHero';

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
    // force the prefers-reduced-motion path: full route + visible pin, no loop
    vi.stubGlobal('matchMedia', vi.fn().mockReturnValue({ matches: true }));
    const { container } = render(<GridHero />);
    expect(container.querySelectorAll('.gh-cell')).toHaveLength(buildBoard(WORD).cells.length);
    const line = container.querySelector<SVGPathElement>('.route-line');
    expect(line).not.toBeNull();
    expect(line!.style.strokeDashoffset).toBe('0');
    const pin = container.querySelector<SVGGElement>('.gh-pin');
    expect(pin!.style.opacity).toBe('1');
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });
});
