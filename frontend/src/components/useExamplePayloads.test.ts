/** The homepage's example maps: loaded, retried, and given up on (useExamplePayloads.ts). */
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import { useExamplePayloads, RETRY_AFTER_MS, type ExampleLoad } from './useExamplePayloads';
import type { PublicStorePayload } from '../types';

const SLUGS = ['a', 'b'];
const map = (slug: string) => ({ store: { slug } } as unknown as PublicStorePayload);

// the retries wait real seconds — the clock is the test's to turn
beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

/** Advance fake time, letting whatever that schedules resolve. */
const pass = async (ms: number) => {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
};
const statuses = (loads: Record<string, ExampleLoad>) => Object.fromEntries(Object.entries(loads).map(([slug, load]) => [slug, load.status]));
const callsFor = (fetchPayload: ReturnType<typeof vi.fn>, slug: string) => fetchPayload.mock.calls.filter(([s]) => s === slug).length;

describe('useExamplePayloads', () => {
  it('loads every example', async () => {
    const fetchPayload = vi.fn(async (slug: string) => map(slug));
    const { result } = renderHook(() => useExamplePayloads(SLUGS, fetchPayload));
    expect(statuses(result.current.loads)).toEqual({ a: 'loading', b: 'loading' });
    await pass(0);
    const a = result.current.loads.a;
    expect(statuses(result.current.loads)).toEqual({ a: 'ready', b: 'ready' });
    expect(a.status === 'ready' && a.data.store.slug).toBe('a');
  });

  it('tries a failed example again after each pause, then gives up', async () => {
    const fetchPayload = vi.fn(async (slug: string) => {
      if (slug === 'b') throw new Error('Internal Server Error');
      return map(slug);
    });
    const { result } = renderHook(() => useExamplePayloads(SLUGS, fetchPayload));
    await pass(0);
    // failed once — but not given up on: the retries are still to come
    expect(statuses(result.current.loads)).toEqual({ a: 'ready', b: 'loading' });
    for (const [i, pause] of RETRY_AFTER_MS.entries()) {
      expect(callsFor(fetchPayload, 'b'), `attempts before pause ${i + 1}`).toBe(i + 1);
      await pass(pause - 1);
      expect(callsFor(fetchPayload, 'b'), `not retried early`).toBe(i + 1);
      await pass(1);
      expect(callsFor(fetchPayload, 'b'), `retried after pause ${i + 1}`).toBe(i + 2);
    }
    await pass(0);
    expect(statuses(result.current.loads)).toEqual({ a: 'ready', b: 'failed' });
    // an example that loaded is never asked for again
    expect(callsFor(fetchPayload, 'a')).toBe(1);
  });

  it('"Try again" starts only the failed examples over', async () => {
    let down = true;
    const fetchPayload = vi.fn(async (slug: string) => {
      if (slug === 'b' && down) throw new Error('Internal Server Error');
      return map(slug);
    });
    const { result } = renderHook(() => useExamplePayloads(SLUGS, fetchPayload));
    await pass(RETRY_AFTER_MS.reduce((sum, ms) => sum + ms, 0) + 1);
    expect(statuses(result.current.loads)).toEqual({ a: 'ready', b: 'failed' });

    down = false;
    act(() => result.current.retry());
    expect(statuses(result.current.loads)).toEqual({ a: 'ready', b: 'loading' });
    await pass(0);
    expect(statuses(result.current.loads)).toEqual({ a: 'ready', b: 'ready' });
    expect(callsFor(fetchPayload, 'a')).toBe(1);
  });

  it('stops retrying once the page is gone', async () => {
    const fetchPayload = vi.fn(async () => {
      throw new Error('Internal Server Error');
    });
    const { unmount } = renderHook(() => useExamplePayloads(['a'], fetchPayload));
    await pass(0);
    unmount();
    await pass(RETRY_AFTER_MS[0] + 1);
    expect(fetchPayload).toHaveBeenCalledTimes(1);
  });
});
