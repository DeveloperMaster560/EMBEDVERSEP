import type { AgentBudget } from './contracts.js';

export const DEFAULT_TASK_BUDGET: Readonly<AgentBudget> = Object.freeze({
  maxTurns: 12,
  maxToolCalls: 20,
  maxRetries: 3,
  maxDurationMs: 10 * 60 * 1000,
  maxTokens: 24_000,
});

export function enforceBudget(requested: Partial<AgentBudget> = {}): AgentBudget {
  const budget = { ...DEFAULT_TASK_BUDGET, ...requested };
  for (const [name, value] of Object.entries(budget)) {
    if (value === undefined) continue;
    const minimum = name === 'maxRetries' ? 0 : 1;
    if (!Number.isSafeInteger(value) || value < minimum) {
      throw new Error(`El presupuesto ${name} debe ser un entero igual o mayor que ${minimum}.`);
    }
    const cap = DEFAULT_TASK_BUDGET[name as keyof AgentBudget];
    if (cap !== undefined && value > cap) {
      throw new Error(`El presupuesto ${name} supera el máximo permitido (${cap}).`);
    }
  }
  return budget;
}
