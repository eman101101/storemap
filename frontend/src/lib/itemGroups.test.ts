import { describe, it, expect } from 'vitest';
import { groupPrice } from './itemGroups';

describe('groupPrice', () => {
  it('is deterministic and price-like', () => {
    expect(groupPrice('Oat Drink 1L', 0)).toBe(groupPrice('Oat Drink 1L', 0));
    const p = groupPrice('Oat Drink 1L', 3);
    expect(p).toBeGreaterThan(0.5);
    expect(p).toBeLessThan(8);
    expect(Number.isInteger(Math.round(p * 100))).toBe(true);
  });
});
