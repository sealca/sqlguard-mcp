import type { QueryClassification, PolicyRule, ImpactEstimate, SecurityMode } from '../types.js';

export interface PolicyDecision {
  blocked: boolean;
  blockReason?: string;
  requiresConfirmation: boolean;
  warnings: string[];
}

export function evaluatePolicy(
  classification: QueryClassification,
  impact: ImpactEstimate,
  rules: PolicyRule[],
  mode: SecurityMode = 'strict'
): PolicyDecision {
  const warnings: string[] = [];

  // ─── read-only: block everything except SELECT ─────────────────────────
  if (mode === 'read-only') {
    if (classification.type !== 'READ') {
      return {
        blocked: true,
        blockReason: `[SQLGuard read-only] ${classification.operation} is blocked. Only SELECT queries are allowed in read-only mode.`,
        requiresConfirmation: false,
        warnings,
      };
    }
    return { blocked: false, requiresConfirmation: false, warnings };
  }

  // ─── permissive: allow everything, warn on destructive ─────────────────
  if (mode === 'permissive') {
    if (classification.type === 'DESTRUCTIVE' || classification.isUnsafe) {
      warnings.push(
        `[SQLGuard permissive] WARNING: ${classification.operation} on ${classification.tables.join(', ') || 'unknown table'} — executing without block.`
      );
    }
    return { blocked: false, requiresConfirmation: false, warnings };
  }

  // ─── strict (default): block unsafe, confirm writes ────────────────────
  if (classification.isUnsafe) {
    return {
      blocked: true,
      blockReason: `[SQLGuard strict] ${classification.reason ?? `${classification.operation} is blocked for safety`}`,
      requiresConfirmation: false,
      warnings,
    };
  }

  // Check blocked tables from rules
  for (const rule of rules) {
    if (rule.blockedTables && rule.blockedTables.length > 0) {
      const hitTable = classification.tables.find((t) =>
        rule.blockedTables!.map((b) => b.toLowerCase()).includes(t.toLowerCase())
      );
      if (hitTable) {
        return {
          blocked: true,
          blockReason: `Table '${hitTable}' is blocked by rule '${rule.name}'`,
          requiresConfirmation: false,
          warnings,
        };
      }
    }
  }

  if (impact.warningMessage) {
    warnings.push(impact.warningMessage);
  }

  const requiresConfirmation =
    classification.type === 'WRITE' || classification.type === 'DESTRUCTIVE';

  return {
    blocked: false,
    requiresConfirmation,
    warnings,
  };
}
