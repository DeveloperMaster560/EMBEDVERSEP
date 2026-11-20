import type { TaskState } from './contracts.js';

const transitions: Readonly<Record<TaskState, readonly TaskState[]>> = {
  PENDING: ['IN_PROGRESS', 'CANCELLED', 'FAILED'],
  IN_PROGRESS: ['WAITING_FOR_AGENT', 'WAITING_FOR_HUMAN', 'COMPLETED', 'FAILED', 'CANCELLED'],
  WAITING_FOR_AGENT: ['IN_PROGRESS', 'WAITING_FOR_HUMAN', 'FAILED', 'CANCELLED'],
  WAITING_FOR_HUMAN: ['IN_PROGRESS', 'FAILED', 'CANCELLED'],
  COMPLETED: [],
  FAILED: [],
  CANCELLED: [],
};

export function canTransitionTask(from: TaskState, to: TaskState): boolean {
  return transitions[from].includes(to);
}

export function assertTaskTransition(from: TaskState, to: TaskState): void {
  if (!canTransitionTask(from, to)) {
    throw new Error(`Transición de tarea no permitida: ${from} → ${to}.`);
  }
}
