import type { QueryClassification, PolicyRule, ImpactEstimate } from '../types.js';

export interface PolicyDecision {
  blocked: boolean;
  blockReason?: string;
  requiresConfirmation: boolean;
  warnings: string[];
}

export function evaluatePolicy(
  classification: QueryClassification,
  impact: ImpactEstimate,
  rules: PolicyRule[]
): PolicyDecision {
  const warnings: string[] = [];

  // Always block isUnsafe queries (DELETE without WHERE, DROP, TRUNCATE, ALTER)
  if (classification.isUnsafe) {
    return {
      blocked: true,
      blockReason: classification.reason ?? `${classification.operation} is blocked for safety`,
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

  // Collect warnings
  if (impact.warningMessage) {
    warnings.push(impact.warningMessage);
  }

  // WRITE queries require confirmation
  const requiresConfirmation =
    classification.type === 'WRITE' || classification.type === 'DESTRUCTIVE';

  return {
    blocked: false,
    requiresConfirmation,
    warnings,
  };
}
