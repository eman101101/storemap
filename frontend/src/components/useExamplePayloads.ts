/**
 * The homepage's example maps (Landing.tsx), each fetched with a few retries.
 * Kept apart from the page so the retry behaviour can be tested on its own.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { api } from '../api';
import type { PublicStorePayload } from '../types';

/** One example's public map while the homepage loads it. */
export type ExampleLoad = { status: 'loading' } | { status: 'ready'; data: PublicStorePayload } | { status: 'failed' };

/** Pauses before the first, second and third retry of a failed example. */
export const RETRY_AFTER_MS = [1500, 4000, 10_000];

/**
 * The example maps — a blank slide rotating through the hero is worse than a
 * late one, so a failed one is tried again before it is given up on.
 * `retry` starts the failed ones over (the hero's "Try again"); ready ones
 * are kept.
 */
export function useExamplePayloads(
  slugs: readonly string[],
  fetchPayload: (slug: string) => Promise<PublicStorePayload> = api.publicStore
) {
  const [loads, setLoads] = useState<Record<string, ExampleLoad>>(() =>
    Object.fromEntries(slugs.map((slug) => [slug, { status: 'loading' } as ExampleLoad]))
  );
  const [round, setRound] = useState(0);
  // what the effect skips: an example that is already loaded is never fetched
  // again (a retry round must not re-download the others)
  const latest = useRef(loads);
  latest.current = loads;
  useEffect(() => {
    let live = true;
    const timers: number[] = [];
    for (const slug of slugs) {
      if (latest.current[slug]?.status === 'ready') continue;
      const attempt = (retriesLeft: number) => {
        fetchPayload(slug)
          .then((data) => live && setLoads((prev) => ({ ...prev, [slug]: { status: 'ready', data } })))
          .catch(() => {
            if (!live) return;
            if (retriesLeft === 0) {
              setLoads((prev) => ({ ...prev, [slug]: { status: 'failed' } }));
              return;
            }
            timers.push(window.setTimeout(() => attempt(retriesLeft - 1), RETRY_AFTER_MS[RETRY_AFTER_MS.length - retriesLeft]));
          });
      };
      attempt(RETRY_AFTER_MS.length);
    }
    return () => {
      live = false;
      timers.forEach((t) => window.clearTimeout(t));
    };
  }, [slugs, fetchPayload, round]);
  const retry = useCallback(() => {
    setLoads((prev) =>
      Object.fromEntries(Object.entries(prev).map(([slug, load]) => [slug, load.status === 'failed' ? { status: 'loading' } : load]))
    );
    setRound((r) => r + 1);
  }, []);
  return { loads, retry };
}
