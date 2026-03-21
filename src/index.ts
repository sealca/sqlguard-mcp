/**
 * SQLGuard MCP — SQL Safety Layer for AI Agents
 *
 * Usage:
 *   npx sqlguard-mcp --pg "postgresql://user:pass@host/db"
 *   npx sqlguard-mcp --sqlite "./mydb.sqlite"
 *   npx sqlguard-mcp --sqlite ":memory:"
 *
 * Pro version with audit logs, custom rules, and more:
 *   https://sealca.gumroad.com/l/sqlguard-mcp
 */

import { createConnection } from './db/connection.js';
import { startServer } from './server.js';
import type { ConnectionConfig, SecurityMode, ServerConfig } from './types.js';

const VALID_MODES = new Set<SecurityMode>(['read-only', 'strict', 'permissive']);

function parseArgs(): { connectionConfig: ConnectionConfig; serverConfig: ServerConfig } {
  const args = process.argv.slice(2);

  let connectionConfig: ConnectionConfig | null = null;

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    const next = args[i + 1];

    if (arg === '--pg' && next) {
      connectionConfig = {
        type: 'postgresql',
        connectionString: next,
      };
      i++;
    } else if (arg === '--sqlite' && next) {
      connectionConfig = {
        type: 'sqlite',
        filePath: next === ':memory:' ? undefined : next,
      };
      i++;
    } else if (arg === '--host' && next) {
      if (!connectionConfig || connectionConfig.type !== 'postgresql') {
        connectionConfig = { type: 'postgresql' };
      }
      connectionConfig.host = next;
      i++;
    } else if (arg === '--port' && next) {
      if (!connectionConfig) connectionConfig = { type: 'postgresql' };
      connectionConfig.port = parseInt(next, 10);
      i++;
    } else if (arg === '--database' && next) {
      if (!connectionConfig) connectionConfig = { type: 'postgresql' };
      connectionConfig.database = next;
      i++;
    } else if (arg === '--user' && next) {
      if (!connectionConfig) connectionConfig = { type: 'postgresql' };
      connectionConfig.user = next;
      i++;
    } else if (arg === '--password' && next) {
      if (!connectionConfig) connectionConfig = { type: 'postgresql' };
      connectionConfig.password = next;
      i++;
    } else if (arg === '--ssl') {
      if (!connectionConfig) connectionConfig = { type: 'postgresql' };
      connectionConfig.ssl = true;
    } else if (arg === '--help' || arg === '-h') {
      printHelp();
      process.exit(0);
    }
  }

  // Also check environment variables
  if (!connectionConfig) {
    const pgConn = process.env['SQLGUARD_PG'] ?? process.env['DATABASE_URL'];
    const sqliteFile = process.env['SQLGUARD_SQLITE'];

    if (pgConn) {
      connectionConfig = { type: 'postgresql', connectionString: pgConn };
    } else if (sqliteFile) {
      connectionConfig = { type: 'sqlite', filePath: sqliteFile };
    }
  }

  if (!connectionConfig) {
    console.error('Error: No database connection specified.\n');
    printHelp();
    process.exit(1);
  }

  // Parse security mode
  const modeArg = args.find((a, i) => args[i - 1] === '--mode');
  const modeEnv = process.env['SQLGUARD_MODE'];
  const rawMode = modeArg ?? modeEnv ?? 'strict';
  const mode: SecurityMode = VALID_MODES.has(rawMode as SecurityMode)
    ? (rawMode as SecurityMode)
    : 'strict';

  if (rawMode && !VALID_MODES.has(rawMode as SecurityMode)) {
    console.error(
      `[sqlguard-mcp] Warning: Unknown mode "${rawMode}", defaulting to "strict". Valid modes: read-only, strict, permissive`
    );
  }

  const serverConfig: ServerConfig = {
    connection: connectionConfig,
    mode,
  };

  return { connectionConfig, serverConfig };
}

function printHelp(): void {
  console.error(`
SQLGuard MCP v1.0.0 — SQL Safety Layer for AI Agents
-----------------------------------------------------

USAGE:
  npx sqlguard-mcp [options]

CONNECTION (one required):
  --pg <connection-string>   PostgreSQL connection string
                             e.g. postgresql://user:pass@localhost:5432/mydb
  --sqlite <file>            SQLite database file path or :memory:

  Individual PostgreSQL options:
  --host <host>              PostgreSQL host (default: localhost)
  --port <port>              PostgreSQL port (default: 5432)
  --database <db>            Database name
  --user <user>              Username
  --password <pass>          Password
  --ssl                      Enable SSL

SECURITY MODE:
  --mode <mode>              Security mode (default: strict)
                             read-only   — only SELECT allowed
                             strict      — writes need confirmation, destructive blocked
                             permissive  — everything executes, destructive ops warned

ENVIRONMENT VARIABLES:
  SQLGUARD_PG                PostgreSQL connection string
  SQLGUARD_SQLITE            SQLite file path
  SQLGUARD_MODE              Security mode (read-only | strict | permissive)

EXAMPLES:
  # PostgreSQL
  npx sqlguard-mcp --pg "postgresql://admin:secret@localhost/myapp"

  # SQLite
  npx sqlguard-mcp --sqlite "./production.db"

Pro version (audit log, custom YAML rules, multiple connections):
  https://sealca.gumroad.com/l/sqlguard-mcp
`);
}

async function main(): Promise<void> {
  try {
    const { connectionConfig, serverConfig } = parseArgs();

    process.stderr.write(
      `[sqlguard-mcp] Connecting to ${connectionConfig.type}...\n`
    );

    const db = await createConnection(connectionConfig);

    process.stderr.write(
      `[sqlguard-mcp] Connected. Mode: ${serverConfig.mode}. Starting MCP server...\n`
    );

    await startServer(db, serverConfig);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`[sqlguard-mcp] Fatal error: ${message}`);
    process.exit(1);
  }
}

main();
