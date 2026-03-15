import { describe, it, expect, vi } from 'vitest';
import { executeQuery } from '../src/db/executor.js';
import type { DbConnection } from '../src/db/connection.js';
import type { QueryAnalysis } from '../src/types.js';

function makeDb(overrides: Partial<DbConnection> = {}): DbConnection {
  return {
    type: 'postgresql',
    queryRaw: vi.fn().mockResolvedValue([{ id: 1, name: 'Alice' }]),
    execute: vi.fn().mockResolvedValue({ rowsAffected: 1 }),
    listTables: vi.fn().mockResolvedValue([]),
    getTableSchema: vi.fn().mockResolvedValue([]),
    close: vi.fn().mockResolvedValue(undefined),
    isConnected: vi.fn().mockReturnValue(true),
    ...overrides,
  };
}

function makeAnalysis(overrides: Partial<QueryAnalysis> = {}): QueryAnalysis {
  return {
    query: 'SELECT * FROM users',
    classification: {
      type: 'READ',
      operation: 'SELECT',
      tables: ['users'],
      hasWhereClause: false,
      isUnsafe: false,
    },
    impact: {
      estimatedRowsAffected: null,
      explainOutput: '',
      requiresConfirmation: false,
    },
    blocked: false,
    ...overrides,
  };
}

describe('executeQuery', () => {
  it('executes READ query and returns rows', async () => {
    const db = makeDb();
    const result = await executeQuery('SELECT * FROM users', makeAnalysis(), db);
    expect(result.success).toBe(true);
    expect(result.rows).toHaveLength(1);
    expect(result.rows?.[0]).toEqual({ id: 1, name: 'Alice' });
  });

  it('throws when query is blocked', async () => {
    const db = makeDb();
    const analysis = makeAnalysis({ blocked: true, blockReason: 'Table is protected' });
    await expect(executeQuery('DELETE FROM users', analysis, db)).rejects.toThrow('blocked');
  });

  it('executes WRITE query and returns rowsAffected', async () => {
    const db = makeDb();
    const analysis = makeAnalysis({
      query: "UPDATE users SET active = true WHERE id = 1",
      classification: {
        type: 'WRITE',
        operation: 'UPDATE',
        tables: ['users'],
        hasWhereClause: true,
        isUnsafe: false,
      },
    });
    const result = await executeQuery("UPDATE users SET active = true WHERE id = 1", analysis, db);
    expect(result.success).toBe(true);
    expect(result.rowsAffected).toBe(1);
  });

  it('handles execution errors gracefully', async () => {
    const db = makeDb({
      queryRaw: vi.fn().mockRejectedValue(new Error('column "foo" does not exist')),
    });
    const result = await executeQuery('SELECT foo FROM users', makeAnalysis(), db);
    expect(result.success).toBe(false);
    expect(result.error).toContain('column "foo"');
  });

  it('records executionTimeMs', async () => {
    const db = makeDb();
    const result = await executeQuery('SELECT 1', makeAnalysis(), db);
    expect(result.executionTimeMs).toBeGreaterThanOrEqual(0);
  });
});
