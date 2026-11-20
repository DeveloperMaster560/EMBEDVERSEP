import type { AgentDefinition } from './contracts.js';
import { DEFAULT_TASK_BUDGET } from './policy.js';

export const AGENT_REGISTRY: Readonly<Record<AgentDefinition['id'], AgentDefinition>> = {
  structural_engineer: {
    id: 'structural_engineer',
    name: 'EMBEVERSE Structural Engineer AI',
    specialty: 'Modelado estructural conceptual e integración geométrica.',
    capabilities: ['workspace.read_file', 'workspace.search'],
    toolIds: ['workspace.read_file', 'workspace.search'],
    budget: DEFAULT_TASK_BUDGET,
    availability: 'WAITING_FOR_PROVIDER',
  },
  software_engineer: {
    id: 'software_engineer',
    name: 'EMBEVERSE Software Systems Engineer AI',
    specialty: 'Diagnóstico, integración y verificación del software de la plataforma.',
    capabilities: ['workspace.read_file', 'workspace.search'],
    toolIds: ['workspace.read_file', 'workspace.search'],
    budget: DEFAULT_TASK_BUDGET,
    availability: 'WAITING_FOR_PROVIDER',
  },
  mechatronics_engineer: {
    id: 'mechatronics_engineer',
    name: 'EMBEVERSE Mechatronics Engineer AI',
    specialty: 'Circuitos, sensores, firmware y sistemas embebidos.',
    capabilities: ['workspace.read_file', 'workspace.search'],
    toolIds: ['workspace.read_file', 'workspace.search'],
    budget: DEFAULT_TASK_BUDGET,
    availability: 'WAITING_FOR_PROVIDER',
  },
};

export function getAgentDefinition(id: string): AgentDefinition | undefined {
  if (Object.hasOwn(AGENT_REGISTRY, id)) return AGENT_REGISTRY[id as keyof typeof AGENT_REGISTRY];
  return undefined;
}
