import type { DbConnection } from './connection.js';
import type { QueryAnalysis, ExecuteResult } from '../types.js';

export async function executeQuery(
  sql: string,
  analysis: QueryAnalysis,
  db: DbConnection
): Promise<ExecuteResult> {
  if (analysis.blocked) {
    throw new Error(`Query blocked: ${analysis.blockReason}`);
  }

  const start = Date.now();

  try {
    if (analysis.classification.type === 'READ') {
      const rows = await db.queryRaw(sql);
      return {
        success: true,
        rows,
        rowsAffected: 0,
        executionTimeMs: Date.now() - start,
      };
    }

    const result = await db.execute(sql);
    return {
      success: true,
      rowsAffected: result.rowsAffected,
      executionTimeMs: Date.now() - start,
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return {
      success: false,
      error: message,
      executionTimeMs: Date.now() - start,
    };
  }
}
