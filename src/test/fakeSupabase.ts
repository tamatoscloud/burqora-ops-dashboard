/**
 * BUR-25: a minimal stand-in for SupabaseClient. Records every rpc() and table call and answers
 * from canned data, so panel tests never touch the network.
 */
import {vi} from 'vitest';
import type {SupabaseClient} from '@supabase/supabase-js';

type Result = {data: unknown; error: {message: string} | null};

export type FakeSupabase = {
  client: SupabaseClient;
  rpc: ReturnType<typeof vi.fn>;
  /** Every table touched and how: [{table, op}] — op is select/insert/update/upsert/delete. */
  tableCalls: Array<{table: string; op: string}>;
  setTable: (table: string, rows: unknown[] | {error: string}) => void;
  setRpc: (name: string, result: Result | ((args: unknown) => Result | Promise<Result>)) => void;
};

export function createFakeSupabase(): FakeSupabase {
  const tables = new Map<string, unknown[] | {error: string}>();
  const rpcs = new Map<string, Result | ((args: unknown) => Result | Promise<Result>)>();
  const tableCalls: Array<{table: string; op: string}> = [];

  const rpc = vi.fn(async (name: string, args?: unknown): Promise<Result> => {
    const r = rpcs.get(name);
    if (!r) {
      return {data: null, error: {message: `unexpected rpc ${name}`}};
    }
    return typeof r === 'function' ? r(args) : r;
  });

  function query(table: string, op: string) {
    tableCalls.push({table, op});
    const answer = (): Result => {
      const t = tables.get(table);
      if (t && !Array.isArray(t)) {
        return {data: null, error: {message: t.error}};
      }
      return {data: t ?? [], error: null};
    };
    const builder: Record<string, unknown> = {};
    for (const m of ['select', 'order', 'limit', 'eq', 'in', 'is', 'gte', 'lte', 'filter', 'range']) {
      builder[m] = () => builder;
    }
    builder.then = (ok: (r: Result) => unknown, bad?: (e: unknown) => unknown) =>
      Promise.resolve(answer()).then(ok, bad);
    return builder;
  }

  const client = {
    rpc,
    from: (table: string) => ({
      select: () => query(table, 'select'),
      insert: () => query(table, 'insert'),
      update: () => query(table, 'update'),
      upsert: () => query(table, 'upsert'),
      delete: () => query(table, 'delete'),
    }),
  } as unknown as SupabaseClient;

  return {
    client,
    rpc,
    tableCalls,
    setTable: (t, rows) => tables.set(t, rows),
    setRpc: (n, r) => rpcs.set(n, r),
  };
}
