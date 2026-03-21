# SQLGuard MCP

[![npm version](https://img.shields.io/npm/v/sqlguard-mcp)](https://www.npmjs.com/package/sqlguard-mcp)
[![npm downloads](https://img.shields.io/npm/dm/sqlguard-mcp)](https://www.npmjs.com/package/sqlguard-mcp)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](./LICENSE)

**A safety layer MCP server that sits between AI agents (Claude Code, Cursor) and your database.**

AI agents are powerful but can accidentally run `DELETE FROM users` or `DROP TABLE orders`. SQLGuard MCP intercepts every SQL query, classifies it, estimates impact, and requires explicit confirmation before any mutation touches your data.

## How it works

```
Claude/Cursor --> SQLGuard MCP --> [Classify] --> [EXPLAIN] --> [Policy Check] --> DB
                                                    |
                                         Block or ask for confirmation
```

## Quick start

Add to your MCP client config (Claude Code, Cursor, etc.):

```json
{
  "mcpServers": {
    "sqlguard": {
      "command": "npx",
      "args": ["sqlguard-mcp", "--pg", "postgresql://user:pass@localhost/mydb"]
    }
  }
}
```

Or for SQLite:

```json
{
  "mcpServers": {
    "sqlguard": {
      "command": "npx",
      "args": ["sqlguard-mcp", "--sqlite", "./mydb.sqlite"]
    }
  }
}
```

## What it does

| Feature | Description |
|---------|-------------|
| **Query classification** | Every query is classified as READ, WRITE, or DESTRUCTIVE |
| **Destructive query blocker** | `DELETE`/`DROP`/`TRUNCATE`/`ALTER` without `WHERE` are blocked automatically |
| **EXPLAIN interceptor** | Runs `EXPLAIN` before any mutation to show the execution plan |
| **Impact estimation** | Estimates rows affected before executing |
| **Human confirmation** | WRITE/DESTRUCTIVE queries return analysis and require `confirmed: true` |

## MCP tools

Once connected, the AI agent has access to these tools:

| Tool | Description |
|------|-------------|
| `query` | Execute SQL with safety checks |
| `explain` | Run EXPLAIN without executing |
| `tables` | List all tables in the database |
| `schema` | Show schema for a specific table |
| `status` | Connection status and active rules |

## Usage examples

### Claude Code workflow

The AI agent interacts with your DB through these tools automatically. Example conversation:

```
You:    Update all inactive users' last_seen to NULL
Claude: [calls query tool with UPDATE users SET last_seen = NULL WHERE active = 0]

SQLGuard returns:
  IMPACT ANALYSIS -- Review before confirming
  ==================================================
  Operation:  UPDATE
  Type:       WRITE
  Tables:     users
  Has WHERE:  Yes

  Estimated rows affected: 1,247
  EXPLAIN output:
  Seq Scan on users (cost=0..450 rows=1247 width=200)

  To execute, call query with confirmed: true

Claude: I found 1,247 inactive users. Should I proceed?

You:    Yes, go ahead
Claude: [calls query with confirmed: true -- executes]
        Rows affected: 1,247. Done.
```

### Blocked query example

```
Claude: [calls query with DELETE FROM orders]

SQLGuard returns:
  QUERY BLOCKED
  Reason: DELETE without WHERE clause will affect all rows
```

## Security modes

Control how SQLGuard handles different query types via `SQLGUARD_MODE` env var or `--mode` flag:

| Mode | SELECT | INSERT/UPDATE | DROP/DELETE/TRUNCATE |
|------|--------|---------------|---------------------|
| `read-only` | Allowed | **Blocked** | **Blocked** |
| `strict` (default) | Allowed | Dry-run + confirmation | **Blocked** |
| `permissive` | Allowed | Allowed | Allowed (with warning) |

### Example config with mode

```json
{
  "mcpServers": {
    "sqlguard": {
      "command": "npx",
      "args": ["sqlguard-mcp", "--pg", "postgresql://user:pass@localhost/mydb"],
      "env": {
        "SQLGUARD_MODE": "read-only"
      }
    }
  }
}
```

Or via CLI flag: `npx sqlguard-mcp --pg "..." --mode strict`

## CLI options

```
CONNECTION (one required):
  --pg <connection-string>   PostgreSQL connection string
  --sqlite <file>            SQLite file path or :memory:

  Individual PostgreSQL options:
  --host, --port, --database, --user, --password, --ssl

SECURITY MODE:
  --mode <mode>              read-only | strict | permissive (default: strict)

ENVIRONMENT VARIABLES:
  SQLGUARD_PG                PostgreSQL connection string
  SQLGUARD_SQLITE            SQLite file path
  SQLGUARD_MODE              Security mode
```

## Supported databases

| Database | Connection |
|----------|-----------|
| PostgreSQL | `--pg "postgresql://user:pass@host/db"` |
| SQLite | `--sqlite "./path/to/db.sqlite"` |

## SQLGuard MCP Pro

Need more control? The Pro version adds:

| Feature | Description |
|---------|-------------|
| **Audit log** | Every query logged to SQLite with timestamp, result, rows affected |
| **Custom rules via YAML** | Block specific tables, cap max rows, restrict by time of day |
| **Multiple connections** | Connect to several databases simultaneously |
| **Dry-run mode** | Preview what a query would do without executing it |

Get Pro: **https://sealca.gumroad.com/l/sqlguard-mcp**

## License

MIT — free to use. Pro features require a commercial license.
