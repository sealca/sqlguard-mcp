import { describe, it, expect } from 'vitest';
import { evaluatePolicy } from '../src/policy/engine.js';
import type { QueryClassification, ImpactEstimate, PolicyRule } from '../src/types.js';

function makeClassification(overrides: Partial<QueryClassification> = {}): QueryClassification {
  return {
    type: 'WRITE',
    operation: 'UPDATE',
    tables: ['users'],
    hasWhereClause: true,
    isUnsafe: false,
    ...overrides,
  };
}

function makeImpact(overrides: Partial<ImpactEstimate> = {}): ImpactEstimate {
  return {
    estimatedRowsAffected: 5,
    explainOutput: 'Seq Scan on users cost=0..100 rows=5',
    requiresConfirmation: true,
    ...overrides,
  };
}

describe('evaluatePolicy', () => {
  it('blocks unsafe queries immediately', () => {
    const classification = makeClassification({
      type: 'DESTRUCTIVE',
      operation: 'DELETE',
      isUnsafe: true,
      reason: 'DELETE without WHERE clause will affect all rows',
    });
    const decision = evaluatePolicy(classification, makeImpact(), []);
    expect(decision.blocked).toBe(true);
    expect(decision.blockReason).toContain('DELETE');
  });

  it('allows safe READ queries', () => {
    const classification = makeClassification({ type: 'READ', operation: 'SELECT', isUnsafe: false });
    const decision = evaluatePolicy(classification, makeImpact({ requiresConfirmation: false }), []);
    expect(decision.blocked).toBe(false);
  });

  it('requires confirmation for WRITE queries', () => {
    const decision = evaluatePolicy(makeClassification(), makeImpact(), []);
    expect(decision.blocked).toBe(false);
    expect(decision.requiresConfirmation).toBe(true);
  });

  it('blocks queries on blocked tables', () => {
    const rules: PolicyRule[] = [
      { name: 'protect-payments', blockedTables: ['payments', 'users'] },
    ];
    const decision = evaluatePolicy(makeClassification({ tables: ['users'] }), makeImpact(), rules);
    expect(decision.blocked).toBe(true);
    expect(decision.blockReason).toContain('users');
  });

  it('adds warning for large impact', () => {
    const decision = evaluatePolicy(
      makeClassification(),
      makeImpact({ estimatedRowsAffected: 5000, warningMessage: 'WARNING: This query will affect approximately 5,000 rows.' }),
      []
    );
    expect(decision.warnings).toHaveLength(1);
    expect(decision.warnings[0]).toContain('5,000');
  });

  it('does not block when no rules match', () => {
    const rules: PolicyRule[] = [
      { name: 'protect-orders', blockedTables: ['orders'] },
    ];
    const decision = evaluatePolicy(makeClassification({ tables: ['users'] }), makeImpact(), rules);
    expect(decision.blocked).toBe(false);
  });
});
