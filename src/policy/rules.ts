import type { PolicyRule } from '../types.js';

export const DEFAULT_FREE_RULES: PolicyRule[] = [
  {
    name: 'block-destructive-without-where',
    requireConfirmationForWrite: true,
  },
];
