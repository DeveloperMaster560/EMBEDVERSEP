import type { AgentBudget } from './contracts.js';

export const DEFAULT_TASK_BUDGET: Readonly<AgentBudget> = Object.freeze({
  maxTurns: 12,
  maxToolCalls: 20,
  maxRetries: 3,
  maxDurationMs: 10 * 60 * 1000,
  // Cuenta prompt + respuesta de cada turno. Con 24.000 una tarea que delega y se reanuda
  // (ventana de 16 k) se quedaba sin presupuesto al tercer turno. En local no hay coste por token:
  // el límite real es el tiempo de trabajo (maxDurationMs).
  maxTokens: 120_000,
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
