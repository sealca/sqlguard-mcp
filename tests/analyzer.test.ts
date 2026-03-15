import { describe, it, expect, vi } from 'vitest';
import { estimateImpact } from '../src/parser/analyzer.js';
import type { DbConnection } from '../src/db/connection.js';

function makeDb(overrides: Partial<DbConnection> = {}): DbConnection {
  return {
    type: 'postgresql',
    queryRaw: vi.fn().mockResolvedValue([
      { 'QUERY PLAN': 'Seq Scan on users  (cost=0.00..1234.00 rows=500 width=100)' },
    ]),
    execute: vi.fn().mockResolvedValue({ rowsAffected: 0 }),
    listTables: vi.fn().mockResolvedValue([]),
    getTableSchema: vi.fn().mockResolvedValue([]),
    close: vi.fn().mockResolvedValue(undefined),
    isConnected: vi.fn().mockReturnValue(true),
    ...overrides,
  };
}

describe('estimateImpact', () => {
  it('returns explain output from PostgreSQL', async () => {
    const db = makeDb();
    const result = await estimateImpact("UPDATE users SET active = true WHERE id = 1", ['users'], db);
    expect(result.explainOutput).toContain('Seq Scan');
    expect(result.requiresConfirmation).toBe(true);
  });

  it('extracts estimated rows from EXPLAIN output', async () => {
    const db = makeDb({
      queryRaw: vi.fn().mockResolvedValue([
        { 'QUERY PLAN': 'Seq Scan on users  (cost=0.00..1234.00 rows=500 width=100)' },
      ]),
    });
    const result = await estimateImpact("UPDATE users SET name = 'x' WHERE active = true", ['users'], db);
    expect(result.estimatedRowsAffected).toBe(500);
  });

  it('adds warning for large impact', async () => {
    const db = makeDb({
      queryRaw: vi.fn().mockResolvedValue([
        { 'QUERY PLAN': 'Seq Scan on orders  (cost=0.00..9999.00 rows=50000 width=50)' },
      ]),
    });
    const result = await estimateImpact("DELETE FROM orders WHERE created_at < '2020-01-01'", ['orders'], db);
    expect(result.warningMessage).toBeDefined();
    expect(result.warningMessage).toMatch(/50[,.]?000/);
  });

  it('handles EXPLAIN failure gracefully', async () => {
    const db = makeDb({
      queryRaw: vi.fn().mockRejectedValue(new Error('syntax error')),
    });
    const result = await estimateImpact('INVALID SQL %%', [], db);
    expect(result.explainOutput).toContain('EXPLAIN failed');
    expect(result.estimatedRowsAffected).toBeNull();
  });

  it('uses COUNT(*) fallback for SQLite', async () => {
    const db: DbConnection = {
      type: 'sqlite',
      queryRaw: vi.fn()
        .mockResolvedValueOnce([{ detail: 'SCAN TABLE users' }]) // EXPLAIN QUERY PLAN
        .mockResolvedValueOnce([{ cnt: 42 }]),                   // COUNT(*)
      execute: vi.fn().mockResolvedValue({ rowsAffected: 0 }),
      listTables: vi.fn().mockResolvedValue([]),
      getTableSchema: vi.fn().mockResolvedValue([]),
      close: vi.fn().mockResolvedValue(undefined),
      isConnected: vi.fn().mockReturnValue(true),
    };

    const result = await estimateImpact("DELETE FROM users WHERE age > 90", ['users'], db);
    expect(result.estimatedRowsAffected).toBe(42);
  });
});
