/**
 * First-boot bootstrap on Workers (src/migrate.ts). A promise belongs to the
 * request that created it: when that request ends while the bootstrap it
 * started is still pending, the promise can never settle — and an isolate
 * holding one is dead for good. These pin what keeps an isolate alive through
 * that: one shared run, a lifeline for it, and a way out for a request that
 * finds the run abandoned.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import type { Env } from '../src/config';

type Stub = { env: Env; statements: string[] };

/**
 * A D1 that records every statement it is asked to run, answers them all with
 * success (no rows), and lets `onCall` delay, fail or gate each one.
 * `applied` is what the migrations ledger holds.
 */
function stubEnv(
  onCall: (sql: string) => Promise<void> | void = () => {},
  { applied = [] as string[] } = {}
): Stub {
  const statements: string[] = [];
  const answer = async (sql: string) => {
    statements.push(sql);
    await onCall(sql);
  };
  const prepare = (sql: string) => ({
    sql,
    bind: () => prepare(sql),
    first: async () => {
      await answer(sql);
      return null;
    },
    run: async () => {
      await answer(sql);
      return { success: true, meta: {}, results: [] };
    },
    all: async () => {
      await answer(sql);
      return { success: true, meta: {}, results: sql === 'SELECT name FROM migrations' ? applied.map((name) => ({ name })) : [] };
    },
  });
  const DB = {
    prepare,
    batch: async (prepared: ReturnType<typeof prepare>[]) => {
      for (const p of prepared) await answer(p.sql);
      return prepared.map(() => ({ success: true, meta: {}, results: [] }));
    },
  };
  return { env: { DB } as unknown as Env, statements };
}

/** How many times the migrations were run — one ledger read per bootstrap. */
const bootstraps = (statements: string[]) => statements.filter((s) => s.startsWith('CREATE TABLE IF NOT EXISTS migrations')).length;

/** The module with its once-per-isolate state cleared, as a new isolate would have it. */
const coldIsolate = async () => {
  vi.resetModules();
  return await import('../src/migrate');
};

afterEach(() => vi.useRealTimers());

describe('bootstrap — once per isolate', () => {
  it('runs once for a burst of requests, which all share the result', async () => {
    const { bootstrap } = await coldIsolate();
    let release!: () => void;
    const gate = new Promise<void>((resolve) => (release = resolve));
    const { env, statements } = stubEnv(() => gate);
    const handed: Promise<unknown>[] = [];
    const lifeline = (pending: Promise<unknown>) => handed.push(pending);

    // a page's worth of requests lands on a cold isolate together
    const requests = Array.from({ length: 25 }, () => bootstrap(env, false, lifeline));
    release();
    const secrets = await Promise.all(requests);

    expect(new Set(secrets).size).toBe(1);
    expect(bootstraps(statements)).toBe(1);
    // only the request that started the run hands it over
    expect(handed).toHaveLength(1);
    expect(await handed[0]).toBe(secrets[0]);
    // done means done: a later request reads the secret and asks the database nothing
    const asked = statements.length;
    expect(await bootstrap(env, false, lifeline)).toBe(secrets[0]);
    expect(statements).toHaveLength(asked);
    expect(handed).toHaveLength(1);
  });

  it('hands its run to keepAlive as a promise that never rejects', async () => {
    const { bootstrap } = await coldIsolate();
    const handed: Promise<unknown>[] = [];
    const broken = stubEnv((sql) => {
      if (sql.startsWith('CREATE TABLE IF NOT EXISTS migrations')) throw new Error('D1 is down');
    });
    // the request still sees the failure…
    await expect(bootstrap(broken.env, false, (p) => handed.push(p))).rejects.toThrow('D1 is down');
    // …but waitUntil() must not be handed a rejection (it logs one as uncaught)
    await expect(handed[0]).resolves.toBeUndefined();
  });
});

describe('bootstrap — when a run cannot be waited on', () => {
  it('takes over from a run its request abandoned', async () => {
    vi.useFakeTimers();
    const { bootstrap } = await coldIsolate();
    // the first request's bootstrap never gets another step: its request is gone
    const abandoned = stubEnv(() => new Promise<void>(() => {}));
    void bootstrap(abandoned.env, false).catch(() => {});
    await vi.advanceTimersByTimeAsync(0);

    // the next request must not be stuck with it
    const mine = stubEnv();
    const waiting = bootstrap(mine.env, false);
    await vi.advanceTimersByTimeAsync(10_000);
    const secret = await waiting;
    expect(typeof secret).toBe('string');
    // it ran the migrations itself — an abandoned run is not a finished one
    expect(bootstraps(mine.statements)).toBe(1);
    expect(abandoned.statements.some((s) => s.includes('ALTER TABLE users ADD COLUMN'))).toBe(false);

    // and the isolate is healthy again
    const later = stubEnv();
    expect(await bootstrap(later.env, false)).toBe(secret);
    expect(later.statements).toHaveLength(0);
  });

  it('gives up waiting only long after a healthy run would have finished', async () => {
    vi.useFakeTimers();
    const { bootstrap } = await coldIsolate();
    let release!: () => void;
    const gate = new Promise<void>((resolve) => (release = resolve));
    // a slow but living run, and a request waiting on it
    const slow = stubEnv(() => gate);
    const owner = bootstrap(slow.env, false);
    const waiter = bootstrap(stubEnv().env, false);
    await vi.advanceTimersByTimeAsync(9_999);
    release();
    expect(await owner).toBe(await waiter);
    // one run between them: the waiter shared it, and never started another
    expect(bootstraps(slow.statements)).toBe(1);
  });

  it('forgets a failed run — for the request that failed and the ones waiting on it', async () => {
    const { bootstrap } = await coldIsolate();
    let hiccups = 1;
    const flaky = stubEnv((sql) => {
      if (hiccups > 0 && sql.startsWith('CREATE TABLE IF NOT EXISTS migrations')) {
        hiccups -= 1;
        throw new Error('D1 hiccup');
      }
    });
    const first = bootstrap(flaky.env, false).catch((err: Error) => err.message);
    const waiting = bootstrap(flaky.env, false); // arrives while the first is in flight

    expect(await first).toBe('D1 hiccup');
    // the waiter does not inherit the failure: it runs a bootstrap of its own
    const secret = await waiting;
    expect(typeof secret).toBe('string');
    expect(bootstraps(flaky.statements)).toBe(2);
    expect(await bootstrap(flaky.env, false)).toBe(secret);
  });
});

describe('migrate', () => {
  it('leaves a recorded migration alone', async () => {
    const { bootstrap } = await coldIsolate();
    const fresh = stubEnv();
    await bootstrap(fresh.env, false);
    expect(fresh.statements.some((s) => s.includes('CREATE TABLE IF NOT EXISTS users ('))).toBe(true);

    const { bootstrap: again } = await coldIsolate();
    const applied = stubEnv(undefined, { applied: ['001_initial_schema'] });
    await again(applied.env, false);
    expect(applied.statements.some((s) => s.includes('CREATE TABLE IF NOT EXISTS users ('))).toBe(false);
    // …while everything after it still runs (015 creates the photo table)
    expect(applied.statements.some((s) => s.includes('CREATE TABLE IF NOT EXISTS media ('))).toBe(true);
  });
});
