export const AGENT_IDS = [
  'structural_engineer',
  'software_engineer',
  'mechatronics_engineer',
] as const;

export type AgentId = (typeof AGENT_IDS)[number];
export type TaskState =
  | 'PENDING'
  | 'IN_PROGRESS'
  | 'WAITING_FOR_AGENT'
  | 'WAITING_FOR_HUMAN'
  | 'COMPLETED'
  | 'FAILED'
  | 'CANCELLED';
export type TaskPriority = 'LOW' | 'NORMAL' | 'HIGH' | 'URGENT';
export type ApprovalState = 'PENDING' | 'APPROVED' | 'REJECTED' | 'EXPIRED';
export type VerificationLevel = 'UNVERIFIED' | 'COMPUTATIONAL' | 'HUMAN_REVIEWED' | 'PHYSICALLY_VERIFIED';

export interface AgentBudget {
  maxTurns: number;
  maxToolCalls: number;
  maxRetries: number;
  maxDurationMs: number;
  maxTokens?: number;
}

export interface AgentTask {
  schemaVersion: 2;
  id: string;
  projectId: string;
  goal: string;
  requestedBy: 'human' | AgentId;
  assignedAgentId: AgentId;
  state: TaskState;
  priority: TaskPriority;
  contextRefs: string[];
  expectedResult: string;
  requiresEvidence: boolean;
  createdAt: string;
  updatedAt: string;
  deadlineAt: string;
  budget: AgentBudget;
  attempt: number;
  parentTaskId?: string;
  cycleKey?: string;
  approvalIds: string[];
  result?: Record<string, unknown>;
  error?: { code: string; message: string };
}

export interface AgentMessage {
  schemaVersion: 1;
  id: string;
  projectId: string;
  taskId: string;
  senderAgentId: AgentId | 'human' | 'system';
  recipientAgentId: AgentId | 'human';
  requestType: string;
  description: string;
  technicalContext: Record<string, unknown>;
  resourceRefs: string[];
  priority: TaskPriority;
  state: 'PENDING' | 'IN_PROGRESS' | 'COMPLETED' | 'FAILED' | 'CANCELLED';
  expectedResult: string;
  createdAt: string;
  correlationId: string;
  causationId?: string;
}

export type AgentPatchState = 'PENDING_APPROVAL' | 'APPROVED' | 'REJECTED' | 'APPLIED' | 'STALE' | 'CANCELLED';

export interface AgentPatchProposal {
  schemaVersion: 1;
  id: string;
  projectId: string;
  taskId: string;
  agentId: AgentId;
  path: string;
  summary: string;
  searchText: string;
  replaceText: string;
  originalSha256: string;
  proposedSha256: string;
  state: AgentPatchState;
  decisionReason?: string;
  appliedSha256?: string;
  createdAt: string;
  updatedAt: string;
}

export type AgentEventType =
  | 'task.created'
  | 'task.state_changed'
  | 'agent.turn_started'
  | 'agent.turn_completed'
  | 'agent.message_sent'
  | 'agent.message_updated'
  | 'patch.proposed'
  | 'patch.state_changed'
  | 'approval.requested'
  | 'approval.decided'
  | 'tool.requested'
  | 'tool.started'
  | 'tool.completed'
  | 'tool.failed'
  | 'knowledge.recorded';

export interface AgentEvent {
  schemaVersion: 1;
  id: string;
  sequence: number;
  projectId: string;
  taskId: string;
  type: AgentEventType;
  actor: AgentId | 'human' | 'system';
  timestamp: string;
  payload: Record<string, unknown>;
  evidenceRefs: string[];
  correlationId: string;
  previousHash: string | null;
  hash: string;
}

export interface KnowledgeRecord {
  schemaVersion: 1;
  id: string;
  projectId?: string;
  category: 'project' | 'technical' | 'component' | 'error' | 'solution' | 'decision';
  subject: string;
  content: string;
  sourceRefs: string[];
  createdBy: AgentId | 'human';
  createdAt: string;
  version: number;
  verificationLevel: VerificationLevel;
  verifiedBy?: string;
  supersedes?: string;
}

export interface AgentDefinition {
  id: AgentId;
  name: string;
  specialty: string;
  capabilities: readonly string[];
  toolIds: readonly string[];
  budget: AgentBudget;
  availability: 'WAITING_FOR_PROVIDER' | 'ACTIVE' | 'ERROR';
}

export interface CreateTaskInput {
  projectId: string;
  goal: string;
  requestedBy?: 'human' | AgentId;
  assignedAgentId: AgentId;
  priority?: TaskPriority;
  contextRefs?: string[];
  expectedResult: string;
  requiresEvidence?: boolean;
  deadlineAt?: string;
  budget?: Partial<AgentBudget>;
  parentTaskId?: string;
  cycleKey?: string;
}

export const TASK_STATES: readonly TaskState[] = [
  'PENDING',
  'IN_PROGRESS',
  'WAITING_FOR_AGENT',
  'WAITING_FOR_HUMAN',
  'COMPLETED',
  'FAILED',
  'CANCELLED',
];
