import type { ConnectionConfig } from '../types.js';

export interface DbConnection {
  type: 'postgresql' | 'sqlite';
  queryRaw(sql: string, params?: unknown[]): Promise<Record<string, unknown>[]>;
  execute(sql: string, params?: unknown[]): Promise<{ rowsAffected: number }>;
  listTables(): Promise<string[]>;
  getTableSchema(tableName: string): Promise<Record<string, unknown>[]>;
  close(): Promise<void>;
  isConnected(): boolean;
}

class PostgresConnection implements DbConnection {
  readonly type = 'postgresql' as const;
  private pool: import('pg').Pool | null = null;
  private connected = false;

  constructor(private readonly config: ConnectionConfig) {}

  async connect(): Promise<void> {
    const { Pool } = await import('pg');
    this.pool = new Pool(
      this.config.connectionString
        ? { connectionString: this.config.connectionString, ssl: this.config.ssl ? { rejectUnauthorized: false } : undefined }
        : {
            host: this.config.host ?? 'localhost',
            port: this.config.port ?? 5432,
            database: this.config.database,
            user: this.config.user,
            password: this.config.password,
            ssl: this.config.ssl ? { rejectUnauthorized: false } : undefined,
          }
    );
    // Test connection
    const client = await this.pool.connect();
    client.release();
    this.connected = true;
  }

  isConnected(): boolean {
    return this.connected;
  }

  async queryRaw(sql: string, params: unknown[] = []): Promise<Record<string, unknown>[]> {
    if (!this.pool) throw new Error('Not connected to PostgreSQL');
    const result = await this.pool.query(sql, params);
    return result.rows as Record<string, unknown>[];
  }

  async execute(sql: string, params: unknown[] = []): Promise<{ rowsAffected: number }> {
    if (!this.pool) throw new Error('Not connected to PostgreSQL');
    const result = await this.pool.query(sql, params);
    return { rowsAffected: result.rowCount ?? 0 };
  }

  async listTables(): Promise<string[]> {
    const rows = await this.queryRaw(
      `SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' ORDER BY table_name`
    );
    return rows.map((r) => String(r['table_name']));
  }

  async getTableSchema(tableName: string): Promise<Record<string, unknown>[]> {
    return this.queryRaw(
      `SELECT column_name, data_type, is_nullable, column_default
       FROM information_schema.columns
       WHERE table_schema = 'public' AND table_name = $1
       ORDER BY ordinal_position`,
      [tableName]
    );
  }

  async close(): Promise<void> {
    if (this.pool) {
      await this.pool.end();
      this.pool = null;
      this.connected = false;
    }
  }
}

class SqliteConnection implements DbConnection {
  readonly type = 'sqlite' as const;
  private db: import('better-sqlite3').Database | null = null;

  constructor(private readonly config: ConnectionConfig) {}

  async connect(): Promise<void> {
    const Database = (await import('better-sqlite3')).default;
    const filePath = this.config.filePath ?? ':memory:';
    this.db = new Database(filePath);
    this.db.pragma('journal_mode = WAL');
    this.db.pragma('foreign_keys = ON');
  }

  isConnected(): boolean {
    return this.db !== null;
  }

  async queryRaw(sql: string, params: unknown[] = []): Promise<Record<string, unknown>[]> {
    if (!this.db) throw new Error('Not connected to SQLite');
    const stmt = this.db.prepare(sql);
    return stmt.all(...params) as Record<string, unknown>[];
  }

  async execute(sql: string, params: unknown[] = []): Promise<{ rowsAffected: number }> {
    if (!this.db) throw new Error('Not connected to SQLite');
    const stmt = this.db.prepare(sql);
    const result = stmt.run(...params);
    return { rowsAffected: result.changes };
  }

  async listTables(): Promise<string[]> {
    const rows = await this.queryRaw(
      `SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name`
    );
    return rows.map((r) => String(r['name']));
  }

  async getTableSchema(tableName: string): Promise<Record<string, unknown>[]> {
    return this.queryRaw(`PRAGMA table_info(${tableName})`);
  }

  async close(): Promise<void> {
    if (this.db) {
      this.db.close();
      this.db = null;
    }
  }
}

export async function createConnection(config: ConnectionConfig): Promise<DbConnection> {
  if (config.type === 'postgresql') {
    const conn = new PostgresConnection(config);
    await conn.connect();
    return conn;
  }

  if (config.type === 'sqlite') {
    const conn = new SqliteConnection(config);
    await conn.connect();
    return conn;
  }

  throw new Error(`Unsupported connection type: ${(config as ConnectionConfig).type}`);
}
