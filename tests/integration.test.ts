/**
 * Integration tests: full safety pipeline using mock DB
 * (native better-sqlite3 requires build tools; real SQLite covered by npm test on CI)
 */
import { describe, it, expect, vi } from 'vitest';
import { classifyQuery } from '../src/parser/classifier.js';
import { estimateImpact } from '../src/parser/analyzer.js';
import { evaluatePolicy } from '../src/policy/engine.js';
import { DEFAULT_FREE_RULES } from '../src/policy/rules.js';
import { executeQuery } from '../src/db/executor.js';
import type { DbConnection } from '../src/db/connection.js';

// Mock SQLite-like in-memory store
function makeInMemoryDb(): DbConnection {
  const tables: Record<string, Record<string, unknown>[]> = {
    users: [
      { id: 1, name: 'Alice', email: 'alice@example.com', active: 1 },
      { id: 2, name: 'Bob', email: 'bob@example.com', active: 1 },
      { id: 3, name: 'Charlie', email: 'charlie@example.com', active: 1 },
    ],
  };

  return {
    type: 'sqlite',
    isConnected: () => true,
    queryRaw: vi.fn().mockImplementation(async (sql: string) => {
      const upper = sql.trim().toUpperCase();
      if (upper.startsWith('EXPLAIN QUERY PLAN')) {
        return [{ detail: 'SCAN TABLE users' }];
      }
      if (upper.startsWith('SELECT COUNT(*)')) {
        const match = sql.match(/FROM\s+(\w+)/i);
        const tableName = match?.[1]?.toLowerCase() ?? 'users';
        return [{ cnt: (tables[tableName] ?? []).length }];
      }
      if (upper.startsWith('SELECT')) {
        const match = sql.match(/FROM\s+(\w+)/i);
        const tableName = match?.[1]?.toLowerCase() ?? 'users';
        return tables[tableName] ?? [];
      }
      return [];
    }),
    execute: vi.fn().mockImplementation(async (sql: string) => {
      const upper = sql.trim().toUpperCase();
      if (upper.startsWith('INSERT INTO')) {
        return { rowsAffected: 1 };
      }
      if (upper.startsWith('UPDATE') || upper.startsWith('DELETE')) {
        return { rowsAffected: 1 };
      }
      return { rowsAffected: 0 };
    }),
    listTables: vi.fn().mockResolvedValue(Object.keys(tables)),
    getTableSchema: vi.fn().mockResolvedValue([
      { name: 'id', type: 'INTEGER', notnull: 1, dflt_value: null, pk: 1 },
      { name: 'name', type: 'TEXT', notnull: 1, dflt_value: null, pk: 0 },
      { name: 'email', type: 'TEXT', notnull: 1, dflt_value: null, pk: 0 },
      { name: 'active', type: 'INTEGER', notnull: 1, dflt_value: '1', pk: 0 },
    ]),
    close: vi.fn().mockResolvedValue(undefined),
  };
}

describe('Integration: full safety pipeline', () => {
  it('lists tables', async () => {
    const db = makeInMemoryDb();
    const tables = await db.listTables();
    expect(tables).toContain('users');
  });

  it('gets table schema', async () => {
    const db = makeInMemoryDb();
    const schema = await db.getTableSchema('users');
    expect(schema.length).toBeGreaterThan(0);
    const names = schema.map((r) => r['name']);
    expect(names).toContain('id');
    expect(names).toContain('name');
  });

  it('SELECT goes through pipeline unblocked', async () => {
    const db = makeInMemoryDb();
    const sql = 'SELECT * FROM users';
    const classification = classifyQuery(sql);
    const impact = await estimateImpact(sql, classification.tables, db);
    const decision = evaluatePolicy(classification, impact, DEFAULT_FREE_RULES);

    expect(classification.type).toBe('READ');
    expect(decision.blocked).toBe(false);
    expect(decision.requiresConfirmation).toBe(false);
  });

  it('DELETE without WHERE is blocked', async () => {
    const db = makeInMemoryDb();
    const sql = 'DELETE FROM users';
    const classification = classifyQuery(sql);
    const impact = await estimateImpact(sql, classification.tables, db);
    const decision = evaluatePolicy(classification, impact, DEFAULT_FREE_RULES);

    expect(classification.isUnsafe).toBe(true);
    expect(decision.blocked).toBe(true);
    expect(decision.blockReason).toBeDefined();
  });

  it('DELETE with WHERE requires confirmation but is not blocked', async () => {
    const db = makeInMemoryDb();
    const sql = 'DELETE FROM users WHERE id = 999';
    const classification = classifyQuery(sql);
    const impact = await estimateImpact(sql, classification.tables, db);
    const decision = evaluatePolicy(classification, impact, DEFAULT_FREE_RULES);

    expect(classification.isUnsafe).toBe(false);
    expect(decision.blocked).toBe(false);
    expect(decision.requiresConfirmation).toBe(true);
  });

  it('DROP TABLE is blocked', async () => {
    const db = makeInMemoryDb();
    const sql = 'DROP TABLE users';
    const classification = classifyQuery(sql);
    const impact = await estimateImpact(sql, classification.tables, db);
    const decision = evaluatePolicy(classification, impact, DEFAULT_FREE_RULES);

    expect(decision.blocked).toBe(true);
  });

  it('custom rule blocks access to protected table', async () => {
    const db = makeInMemoryDb();
    const sql = "UPDATE users SET name = 'hacked' WHERE 1=1";
    const classification = classifyQuery(sql);
    const impact = await estimateImpact(sql, classification.tables, db);
    const decision = evaluatePolicy(classification, impact, [
      { name: 'protect-users', blockedTables: ['users'] },
    ]);

    expect(decision.blocked).toBe(true);
    expect(decision.blockReason).toContain('users');
  });

  it('confirmed WRITE query executes', async () => {
    const db = makeInMemoryDb();
    const sql = "UPDATE users SET active = 0 WHERE id = 1";
    const classification = classifyQuery(sql);
    const impact = await estimateImpact(sql, classification.tables, db);
    const decision = evaluatePolicy(classification, impact, DEFAULT_FREE_RULES);

    const analysis = { query: sql, classification, impact, blocked: decision.blocked };
    const result = await executeQuery(sql, analysis, db);
    expect(result.success).toBe(true);
    expect(result.rowsAffected).toBe(1);
  });

  it('SELECT returns rows from mock db', async () => {
    const db = makeInMemoryDb();
    const sql = 'SELECT * FROM users';
    const rows = await db.queryRaw(sql);
    expect(rows).toHaveLength(3);
    expect(rows[0]['name']).toBe('Alice');
  });
});
