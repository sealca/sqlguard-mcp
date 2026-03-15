import type { ImpactEstimate, ExplainResult } from '../types.js';
import type { DbConnection } from '../db/connection.js';

export async function runExplain(sql: string, db: DbConnection): Promise<ExplainResult> {
  if (db.type === 'postgresql') {
    return runPostgresExplain(sql, db);
  }
  return runSqliteExplain(sql, db);
}

async function runPostgresExplain(sql: string, db: DbConnection): Promise<ExplainResult> {
  try {
    const explainSql = `EXPLAIN (FORMAT TEXT, ANALYZE false) ${sql}`;
    const rows = await db.queryRaw(explainSql);
    const planLines = rows.map((r: Record<string, unknown>) => Object.values(r)[0] as string);
    const plan = planLines.join('\n');

    // Parse estimated rows and cost from EXPLAIN output
    const rowsMatch = plan.match(/rows=(\d+)/);
    const costMatch = plan.match(/cost=[\d.]+\.\.([\d.]+)/);

    return {
      plan,
      estimatedRows: rowsMatch ? parseInt(rowsMatch[1], 10) : null,
      cost: costMatch ? parseFloat(costMatch[1]) : null,
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return {
      plan: `EXPLAIN failed: ${message}`,
      estimatedRows: null,
      cost: null,
    };
  }
}

async function runSqliteExplain(sql: string, db: DbConnection): Promise<ExplainResult> {
  try {
    const explainSql = `EXPLAIN QUERY PLAN ${sql}`;
    const rows = await db.queryRaw(explainSql);
    const plan = rows
      .map((r: Record<string, unknown>) => {
        const detail = r['detail'] ?? r['DETAIL'] ?? Object.values(r).join(' | ');
        return String(detail);
      })
      .join('\n');

    return {
      plan: plan || 'No query plan available',
      estimatedRows: null, // SQLite EXPLAIN QUERY PLAN doesn't give row estimates
      cost: null,
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return {
      plan: `EXPLAIN failed: ${message}`,
      estimatedRows: null,
      cost: null,
    };
  }
}

export async function estimateImpact(
  sql: string,
  tables: string[],
  db: DbConnection
): Promise<ImpactEstimate> {
  const explainResult = await runExplain(sql, db);

  let estimatedRowsAffected: number | null = explainResult.estimatedRows;

  // For SQLite or when EXPLAIN doesn't give rows, try COUNT(*)
  if (estimatedRowsAffected === null && tables.length > 0) {
    estimatedRowsAffected = await estimateViaCount(sql, tables, db);
  }

  const requiresConfirmation = true; // Always require for mutations
  let warningMessage: string | undefined;

  if (estimatedRowsAffected !== null && estimatedRowsAffected > 1000) {
    warningMessage = `WARNING: This query will affect approximately ${estimatedRowsAffected.toLocaleString()} rows.`;
  } else if (estimatedRowsAffected !== null && estimatedRowsAffected === 0) {
    warningMessage = 'This query would affect 0 rows (WHERE clause may be too restrictive).';
  }

  return {
    estimatedRowsAffected,
    explainOutput: explainResult.plan,
    requiresConfirmation,
    warningMessage,
  };
}

async function estimateViaCount(
  sql: string,
  tables: string[],
  db: DbConnection
): Promise<number | null> {
  if (tables.length === 0) return null;

  // Try to extract WHERE clause from the query
  const whereMatch = sql.match(/\bWHERE\b(.+?)(?:\bORDER\b|\bGROUP\b|\bLIMIT\b|\bHAVING\b|$)/is);
  const whereClause = whereMatch ? whereMatch[1].trim() : null;

  try {
    const primaryTable = tables[0];
    const countSql = whereClause
      ? `SELECT COUNT(*) as cnt FROM ${primaryTable} WHERE ${whereClause}`
      : `SELECT COUNT(*) as cnt FROM ${primaryTable}`;

    const rows = await db.queryRaw(countSql);
    if (rows.length > 0) {
      const cnt = rows[0]['cnt'] ?? rows[0]['count(*)'] ?? rows[0]['COUNT(*)'];
      return cnt !== undefined ? parseInt(String(cnt), 10) : null;
    }
  } catch {
    // Silently fail — count estimation is best-effort
  }

  return null;
}
