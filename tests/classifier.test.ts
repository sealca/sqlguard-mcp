import { describe, it, expect } from 'vitest';
import { classifyQuery } from '../src/parser/classifier.js';

describe('classifyQuery', () => {
  describe('READ queries', () => {
    it('classifies SELECT as READ', () => {
      const result = classifyQuery('SELECT * FROM users');
      expect(result.type).toBe('READ');
      expect(result.operation).toBe('SELECT');
    });

    it('classifies SELECT with WHERE as READ', () => {
      const result = classifyQuery('SELECT id, name FROM users WHERE id = 1');
      expect(result.type).toBe('READ');
      expect(result.hasWhereClause).toBe(true);
    });

    it('extracts table names from SELECT', () => {
      const result = classifyQuery('SELECT * FROM products');
      expect(result.tables).toContain('products');
    });

    it('classifies EXPLAIN as READ', () => {
      const result = classifyQuery('EXPLAIN SELECT * FROM orders');
      expect(result.type).toBe('READ');
    });
  });

  describe('WRITE queries', () => {
    it('classifies INSERT as WRITE', () => {
      const result = classifyQuery("INSERT INTO users (name, email) VALUES ('Alice', 'alice@example.com')");
      expect(result.type).toBe('WRITE');
      expect(result.operation).toBe('INSERT');
    });

    it('classifies UPDATE with WHERE as WRITE and not unsafe', () => {
      const result = classifyQuery("UPDATE users SET name = 'Bob' WHERE id = 1");
      expect(result.type).toBe('WRITE');
      expect(result.isUnsafe).toBe(false);
      expect(result.hasWhereClause).toBe(true);
    });

    it('classifies UPDATE without WHERE as WRITE', () => {
      const result = classifyQuery("UPDATE users SET active = false");
      expect(result.type).toBe('WRITE');
    });
  });

  describe('DESTRUCTIVE queries', () => {
    it('classifies DELETE without WHERE as DESTRUCTIVE and unsafe', () => {
      const result = classifyQuery('DELETE FROM users');
      expect(result.type).toBe('DESTRUCTIVE');
      expect(result.isUnsafe).toBe(true);
      expect(result.reason).toContain('WHERE');
    });

    it('classifies DELETE with WHERE as DESTRUCTIVE but not unsafe', () => {
      const result = classifyQuery('DELETE FROM users WHERE id = 1');
      expect(result.type).toBe('DESTRUCTIVE');
      expect(result.isUnsafe).toBe(false);
      expect(result.hasWhereClause).toBe(true);
    });

    it('classifies DROP TABLE as DESTRUCTIVE and unsafe', () => {
      const result = classifyQuery('DROP TABLE users');
      expect(result.type).toBe('DESTRUCTIVE');
      expect(result.isUnsafe).toBe(true);
    });

    it('classifies TRUNCATE as DESTRUCTIVE and unsafe', () => {
      const result = classifyQuery('TRUNCATE TABLE orders');
      expect(result.type).toBe('DESTRUCTIVE');
      expect(result.isUnsafe).toBe(true);
    });

    it('classifies ALTER TABLE as DESTRUCTIVE', () => {
      const result = classifyQuery('ALTER TABLE users ADD COLUMN phone TEXT');
      expect(result.type).toBe('DESTRUCTIVE');
      expect(result.isUnsafe).toBe(true);
    });
  });

  describe('table extraction', () => {
    it('extracts multiple tables from JOIN', () => {
      const result = classifyQuery(
        'SELECT u.name, o.total FROM users u JOIN orders o ON u.id = o.user_id'
      );
      expect(result.tables).toContain('users');
      expect(result.tables).toContain('orders');
    });
  });
});
