import { Parser, type AST } from 'node-sql-parser';
import type { QueryClassification, QueryType } from '../types.js';

const sqlParser = new Parser();

const DESTRUCTIVE_OPS = new Set(['DELETE', 'DROP', 'TRUNCATE', 'ALTER']);
const WRITE_OPS = new Set(['INSERT', 'UPDATE', 'CREATE', 'REPLACE', 'MERGE']);
const READ_OPS = new Set(['SELECT', 'SHOW', 'DESCRIBE', 'DESC', 'EXPLAIN', 'WITH']);

function extractTables(ast: AST | AST[]): string[] {
  const tables: string[] = [];
  const nodes = Array.isArray(ast) ? ast : [ast];

  for (const node of nodes) {
    if (!node) continue;

    if ('from' in node && Array.isArray(node.from)) {
      for (const t of node.from) {
        if (t && typeof t === 'object' && 'table' in t && typeof t.table === 'string') {
          tables.push(t.table);
        }
      }
    }

    if ('table' in node) {
      const tbl = node.table;
      if (Array.isArray(tbl)) {
        for (const t of tbl) {
          if (t && typeof t === 'object' && 'table' in t && typeof t.table === 'string') {
            tables.push(t.table);
          }
        }
      } else if (tbl && typeof tbl === 'object' && 'table' in tbl && typeof tbl.table === 'string') {
        tables.push(tbl.table);
      }
    }
  }

  return [...new Set(tables)];
}

function hasWhereClause(ast: AST | AST[]): boolean {
  const nodes = Array.isArray(ast) ? ast : [ast];
  return nodes.some((node) => node && 'where' in node && node.where !== null);
}

function getOperation(ast: AST | AST[]): string {
  const first = Array.isArray(ast) ? ast[0] : ast;
  if (!first) return 'UNKNOWN';
  return ('type' in first ? String(first.type) : 'UNKNOWN').toUpperCase();
}

function determineType(operation: string): QueryType {
  if (DESTRUCTIVE_OPS.has(operation)) return 'DESTRUCTIVE';
  if (WRITE_OPS.has(operation)) return 'WRITE';
  if (READ_OPS.has(operation)) return 'READ';
  return 'UNKNOWN';
}

function isUnsafeDestructive(operation: string, withWhere: boolean): boolean {
  if (!DESTRUCTIVE_OPS.has(operation)) return false;
  // DELETE without WHERE is always unsafe
  if (operation === 'DELETE' && !withWhere) return true;
  // DROP, TRUNCATE, ALTER are always destructive
  if (['DROP', 'TRUNCATE', 'ALTER'].includes(operation)) return true;
  return false;
}

export function classifyQuery(sql: string): QueryClassification {
  const trimmed = sql.trim();

  // Try to parse with node-sql-parser
  try {
    const ast = sqlParser.astify(trimmed, { database: 'PostgreSQL' });
    const operation = getOperation(ast);
    const type = determineType(operation);
    const tables = extractTables(ast);
    const withWhere = hasWhereClause(ast);
    const unsafe = isUnsafeDestructive(operation, withWhere);

    const reason = unsafe
      ? operation === 'DELETE' && !withWhere
        ? 'DELETE without WHERE clause will affect all rows'
        : `${operation} is a destructive operation that cannot be undone`
      : undefined;

    return { type, operation, tables, hasWhereClause: withWhere, isUnsafe: unsafe, reason };
  } catch {
    // Fallback: regex-based classification for queries the parser can't handle
    return classifyQueryFallback(trimmed);
  }
}

function classifyQueryFallback(sql: string): QueryClassification {
  const upper = sql.toUpperCase().trimStart();

  let operation = 'UNKNOWN';
  let type: QueryType = 'UNKNOWN';

  for (const op of [...DESTRUCTIVE_OPS, ...WRITE_OPS, ...READ_OPS]) {
    if (upper.startsWith(op + ' ') || upper.startsWith(op + '\n') || upper.startsWith(op + '\t')) {
      operation = op;
      break;
    }
  }

  type = determineType(operation);

  // Extract table names heuristically
  const tables: string[] = [];
  const fromMatch = upper.match(/(?:FROM|INTO|UPDATE|TABLE)\s+["'`]?(\w+)["'`]?/gi);
  if (fromMatch) {
    for (const m of fromMatch) {
      const name = m.split(/\s+/).pop();
      if (name) tables.push(name.replace(/["'`]/g, '').toLowerCase());
    }
  }

  const hasWhere = /\bWHERE\b/i.test(sql);
  const unsafe = isUnsafeDestructive(operation, hasWhere);

  return {
    type,
    operation,
    tables: [...new Set(tables)],
    hasWhereClause: hasWhere,
    isUnsafe: unsafe,
    reason: unsafe
      ? operation === 'DELETE' && !hasWhere
        ? 'DELETE without WHERE clause will affect all rows'
        : `${operation} is a destructive operation that cannot be undone`
      : undefined,
  };
}
