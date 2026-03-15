export type QueryType = 'READ' | 'WRITE' | 'DESTRUCTIVE' | 'UNKNOWN';

export interface QueryClassification {
  type: QueryType;
  operation: string;
  tables: string[];
  hasWhereClause: boolean;
  isUnsafe: boolean;
  reason?: string;
}

export interface ExplainResult {
  plan: string;
  estimatedRows: number | null;
  cost: number | null;
}

export interface ImpactEstimate {
  estimatedRowsAffected: number | null;
  explainOutput: string;
  requiresConfirmation: boolean;
  warningMessage?: string;
}

export interface QueryAnalysis {
  query: string;
  classification: QueryClassification;
  impact: ImpactEstimate;
  blocked: boolean;
  blockReason?: string;
}

export interface PolicyRule {
  name: string;
  blockedTables?: string[];
  requireConfirmationForWrite?: boolean;
}

export interface ConnectionConfig {
  type: 'postgresql' | 'sqlite';
  // PostgreSQL
  host?: string;
  port?: number;
  database?: string;
  user?: string;
  password?: string;
  ssl?: boolean;
  connectionString?: string;
  // SQLite
  filePath?: string;
}

export interface ServerConfig {
  connection: ConnectionConfig;
}

export interface ExecuteResult {
  success: boolean;
  rows?: Record<string, unknown>[];
  rowsAffected?: number;
  error?: string;
  executionTimeMs: number;
}
