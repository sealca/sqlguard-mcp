import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import type { DbConnection } from './db/connection.js';
import type { ServerConfig, QueryAnalysis, SecurityMode } from './types.js';
import { classifyQuery } from './parser/classifier.js';
import { runExplain, estimateImpact } from './parser/analyzer.js';
import { evaluatePolicy } from './policy/engine.js';
import { DEFAULT_FREE_RULES } from './policy/rules.js';
import { executeQuery } from './db/executor.js';

export async function createServer(
  db: DbConnection,
  config: ServerConfig
): Promise<McpServer> {
  const mode: SecurityMode = config.mode;
  const server = new McpServer(
    { name: 'sqlguard-mcp', version: '1.0.0' },
    { capabilities: { logging: {} } }
  );

  const activeRules = [...DEFAULT_FREE_RULES];

  // ─── Tool: query ──────────────────────────────────────────────────────────
  server.registerTool(
    'query',
    {
      title: 'Execute SQL Query',
      description:
        'Execute a SQL query with safety checks. READ queries run immediately. ' +
        'WRITE/DESTRUCTIVE queries require analysis review and explicit confirmation.',
      inputSchema: z.object({
        sql: z.string().describe('The SQL query to execute'),
        confirmed: z
          .boolean()
          .optional()
          .describe('Set to true to confirm execution of a WRITE/DESTRUCTIVE query after reviewing the impact analysis'),
      }),
    },
    async ({ sql, confirmed }) => {
      const trimmedSql = sql.trim();

      if (!trimmedSql) {
        return { content: [{ type: 'text', text: 'Error: Empty query' }], isError: true };
      }

      const classification = classifyQuery(trimmedSql);

      // In read-only mode, block non-READ queries before impact analysis
      if (mode === 'read-only' && classification.type !== 'READ') {
        return {
          content: [
            {
              type: 'text',
              text: [
                '[SQLGuard] BLOCKED',
                '',
                `Mode: read-only`,
                `Operation: ${classification.operation}`,
                `Reason: Only SELECT queries are allowed in read-only mode.`,
              ].join('\n'),
            },
          ],
          isError: true,
        };
      }

      // For READ queries, execute immediately
      if (classification.type === 'READ') {
        const start = Date.now();
        try {
          const rows = await db.queryRaw(trimmedSql);
          const executionTimeMs = Date.now() - start;
          const rowCount = rows.length;

          const preview = rows.slice(0, 100);
          return {
            content: [
              {
                type: 'text',
                text: [
                  `Query executed successfully in ${executionTimeMs}ms`,
                  `Rows returned: ${rowCount}${rowCount > 100 ? ' (showing first 100)' : ''}`,
                  '',
                  '```json',
                  JSON.stringify(preview, null, 2),
                  '```',
                ].join('\n'),
              },
            ],
          };
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          return { content: [{ type: 'text', text: `Execution error: ${message}` }], isError: true };
        }
      }

      // For WRITE/DESTRUCTIVE: run impact analysis
      const impact = await estimateImpact(trimmedSql, classification.tables, db);
      const policyDecision = evaluatePolicy(classification, impact, activeRules, mode);

      const analysis: QueryAnalysis = {
        query: trimmedSql,
        classification,
        impact,
        blocked: policyDecision.blocked,
        blockReason: policyDecision.blockReason,
      };

      // If blocked, reject immediately
      if (policyDecision.blocked) {
        return {
          content: [
            {
              type: 'text',
              text: [
                'QUERY BLOCKED',
                '',
                `Reason: ${policyDecision.blockReason}`,
                '',
                `Query: ${trimmedSql}`,
              ].join('\n'),
            },
          ],
          isError: true,
        };
      }

      // In permissive mode, execute directly with warnings
      if (mode === 'permissive' && !policyDecision.blocked) {
        const result = await executeQuery(trimmedSql, analysis, db);
        if (!result.success) {
          return {
            content: [{ type: 'text', text: `Execution error: ${result.error}` }],
            isError: true,
          };
        }
        const lines = [
          'Query executed.',
          `Rows affected: ${result.rowsAffected ?? 0}`,
          `Execution time: ${result.executionTimeMs}ms`,
        ];
        if (policyDecision.warnings.length > 0) {
          lines.push('', ...policyDecision.warnings);
        }
        return { content: [{ type: 'text', text: lines.join('\n') }] };
      }

      // Requires confirmation — return analysis without executing
      if (!confirmed) {
        const lines = [
          'IMPACT ANALYSIS — Review before confirming',
          '='.repeat(50),
          '',
          `Operation:  ${classification.operation}`,
          `Type:       ${classification.type}`,
          `Tables:     ${classification.tables.join(', ') || 'unknown'}`,
          `Has WHERE:  ${classification.hasWhereClause ? 'Yes' : 'No'}`,
          '',
          `Estimated rows affected: ${
            impact.estimatedRowsAffected !== null
              ? impact.estimatedRowsAffected.toLocaleString()
              : 'unknown'
          }`,
        ];

        if (policyDecision.warnings.length > 0) {
          lines.push('');
          lines.push('Warnings:');
          for (const w of policyDecision.warnings) {
            lines.push(`  - ${w}`);
          }
        }

        lines.push('');
        lines.push('EXPLAIN output:');
        lines.push('```');
        lines.push(impact.explainOutput);
        lines.push('```');
        lines.push('');
        lines.push('To execute this query, call the `query` tool again with `confirmed: true`.');

        return { content: [{ type: 'text', text: lines.join('\n') }] };
      }

      // Confirmed — execute
      const result = await executeQuery(trimmedSql, analysis, db);

      if (!result.success) {
        return {
          content: [{ type: 'text', text: `Execution error: ${result.error}` }],
          isError: true,
        };
      }

      return {
        content: [
          {
            type: 'text',
            text: [
              'Query executed successfully.',
              `Rows affected: ${result.rowsAffected ?? 0}`,
              `Execution time: ${result.executionTimeMs}ms`,
            ].join('\n'),
          },
        ],
      };
    }
  );

  // ─── Tool: explain ────────────────────────────────────────────────────────
  server.registerTool(
    'explain',
    {
      title: 'Explain SQL Query',
      description: 'Run EXPLAIN on a SQL query and return the execution plan without executing it.',
      inputSchema: z.object({
        sql: z.string().describe('The SQL query to explain'),
      }),
    },
    async ({ sql }) => {
      try {
        const result = await runExplain(sql.trim(), db);
        const classification = classifyQuery(sql.trim());

        return {
          content: [
            {
              type: 'text',
              text: [
                `Query type: ${classification.type} (${classification.operation})`,
                `Tables: ${classification.tables.join(', ') || 'unknown'}`,
                `Estimated rows: ${result.estimatedRows ?? 'unknown'}`,
                `Cost: ${result.cost ?? 'unknown'}`,
                '',
                'Execution plan:',
                '```',
                result.plan,
                '```',
              ].join('\n'),
            },
          ],
        };
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        return { content: [{ type: 'text', text: `EXPLAIN failed: ${message}` }], isError: true };
      }
    }
  );

  // ─── Tool: tables ─────────────────────────────────────────────────────────
  server.registerTool(
    'tables',
    {
      title: 'List Database Tables',
      description: 'List all tables in the connected database.',
      inputSchema: z.object({}),
    },
    async () => {
      try {
        const tables = await db.listTables();
        return {
          content: [
            {
              type: 'text',
              text:
                tables.length > 0
                  ? `Tables in database (${tables.length}):\n${tables.map((t) => `  - ${t}`).join('\n')}`
                  : 'No tables found in database.',
            },
          ],
        };
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        return { content: [{ type: 'text', text: `Error listing tables: ${message}` }], isError: true };
      }
    }
  );

  // ─── Tool: schema ─────────────────────────────────────────────────────────
  server.registerTool(
    'schema',
    {
      title: 'Get Table Schema',
      description: 'Get the column definitions and schema for a specific table.',
      inputSchema: z.object({
        table: z.string().describe('Table name to inspect'),
      }),
    },
    async ({ table }) => {
      try {
        const schema = await db.getTableSchema(table);
        if (schema.length === 0) {
          return {
            content: [{ type: 'text', text: `Table '${table}' not found or has no columns.` }],
          };
        }

        return {
          content: [
            {
              type: 'text',
              text: [
                `Schema for table: ${table}`,
                '',
                '```json',
                JSON.stringify(schema, null, 2),
                '```',
              ].join('\n'),
            },
          ],
        };
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        return { content: [{ type: 'text', text: `Error fetching schema: ${message}` }], isError: true };
      }
    }
  );

  // ─── Tool: status ─────────────────────────────────────────────────────────
  server.registerTool(
    'status',
    {
      title: 'Server Status',
      description: 'View the current connection status and active rules.',
      inputSchema: z.object({}),
    },
    async () => {
      const lines = [
        'SQLGuard MCP Server Status',
        '='.repeat(40),
        '',
        `Database type:    ${db.type}`,
        `Connected:        ${db.isConnected() ? 'Yes' : 'No'}`,
        `Security mode:    ${mode}`,
        '',
        `Plan:             Free`,
        '',
        `Active rules (${activeRules.length}):`,
        ...activeRules.map((r) => `  - ${r.name}`),
        '',
        'Upgrade to Pro for audit logs, custom YAML rules, and more.',
        'https://sealca.gumroad.com/l/sqlguard-mcp',
      ];

      return { content: [{ type: 'text', text: lines.join('\n') }] };
    }
  );

  return server;
}

export async function startServer(db: DbConnection, config: ServerConfig): Promise<void> {
  const server = await createServer(db, config);
  const transport = new StdioServerTransport();
  await server.connect(transport);
}
