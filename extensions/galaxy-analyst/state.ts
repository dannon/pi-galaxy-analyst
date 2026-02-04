/**
 * Plan state management for Galaxy analysis workflows
 *
 * State is kept in memory during the session and persisted
 * via pi.appendEntry() for recovery after compaction.
 */

import type {
  AnalysisPlan,
  AnalysisStep,
  AnalystState,
  DecisionEntry,
  DecisionType,
  QCCheckpoint,
  CheckpointStatus,
  StepStatus,
  StepResult,
  DatasetReference,
} from "./types";

// Generate simple UUIDs (avoiding external dependency for now)
function generateId(): string {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = Math.random() * 16 | 0;
    const v = c === 'x' ? r : (r & 0x3 | 0x8);
    return v.toString(16);
  });
}

// Module-level state
let state: AnalystState = {
  currentPlan: null,
  recentPlanIds: [],
  galaxyConnected: false,
  currentHistoryId: null,
};

export function getState(): AnalystState {
  return state;
}

export function resetState(): void {
  state = {
    currentPlan: null,
    recentPlanIds: [],
    galaxyConnected: false,
    currentHistoryId: null,
  };
}

/**
 * Restore state from a persisted plan (after compaction)
 */
export function restorePlan(plan: AnalysisPlan): void {
  state.currentPlan = plan;
  if (plan.galaxy.historyId) {
    state.currentHistoryId = plan.galaxy.historyId;
  }
}

/**
 * Create a new analysis plan
 */
export function createPlan(params: {
  title: string;
  researchQuestion: string;
  dataDescription: string;
  expectedOutcomes: string[];
  constraints: string[];
}): AnalysisPlan {
  const now = new Date().toISOString();

  const plan: AnalysisPlan = {
    id: generateId(),
    title: params.title,
    created: now,
    updated: now,
    status: 'draft',
    context: {
      researchQuestion: params.researchQuestion,
      dataDescription: params.dataDescription,
      expectedOutcomes: params.expectedOutcomes,
      constraints: params.constraints,
    },
    galaxy: {
      historyId: state.currentHistoryId,
      historyName: null,
      serverUrl: null,
    },
    steps: [],
    decisions: [],
    checkpoints: [],
  };

  state.currentPlan = plan;
  state.recentPlanIds = [plan.id, ...state.recentPlanIds.slice(0, 9)];

  return plan;
}

/**
 * Get current plan
 */
export function getCurrentPlan(): AnalysisPlan | null {
  return state.currentPlan;
}

/**
 * Update plan status
 */
export function setPlanStatus(status: AnalysisPlan['status']): void {
  if (!state.currentPlan) {
    throw new Error("No active plan");
  }
  state.currentPlan.status = status;
  state.currentPlan.updated = new Date().toISOString();
}

/**
 * Add a step to the current plan
 */
export function addStep(params: {
  name: string;
  description: string;
  executionType: 'tool' | 'workflow' | 'manual';
  toolId?: string;
  workflowId?: string;
  trsId?: string;
  inputs: Array<{ name: string; description: string; fromStep?: string }>;
  expectedOutputs: string[];
  dependsOn: string[];
}): AnalysisStep {
  if (!state.currentPlan) {
    throw new Error("No active plan");
  }

  const stepNumber = state.currentPlan.steps.length + 1;

  const step: AnalysisStep = {
    id: String(stepNumber),
    name: params.name,
    description: params.description,
    status: 'pending',
    execution: {
      type: params.executionType,
      toolId: params.toolId,
      workflowId: params.workflowId,
      trsId: params.trsId,
    },
    inputs: params.inputs.map(i => ({
      name: i.name,
      description: i.description,
      fromStep: i.fromStep,
    })),
    expectedOutputs: params.expectedOutputs,
    actualOutputs: [],
    dependsOn: params.dependsOn,
  };

  state.currentPlan.steps.push(step);
  state.currentPlan.updated = new Date().toISOString();

  return step;
}

/**
 * Update step status
 */
export function updateStepStatus(
  stepId: string,
  status: StepStatus,
  result?: StepResult
): AnalysisStep {
  if (!state.currentPlan) {
    throw new Error("No active plan");
  }

  const step = state.currentPlan.steps.find(s => s.id === stepId);
  if (!step) {
    throw new Error(`Step ${stepId} not found`);
  }

  step.status = status;
  if (result) {
    step.result = result;
  }
  state.currentPlan.updated = new Date().toISOString();

  return step;
}

/**
 * Add outputs to a step
 */
export function addStepOutputs(stepId: string, outputs: DatasetReference[]): void {
  if (!state.currentPlan) {
    throw new Error("No active plan");
  }

  const step = state.currentPlan.steps.find(s => s.id === stepId);
  if (!step) {
    throw new Error(`Step ${stepId} not found`);
  }

  step.actualOutputs.push(...outputs);
  state.currentPlan.updated = new Date().toISOString();
}

/**
 * Log a decision
 */
export function logDecision(params: {
  stepId: string | null;
  type: DecisionType;
  description: string;
  rationale: string;
  researcherApproved: boolean;
}): DecisionEntry {
  if (!state.currentPlan) {
    throw new Error("No active plan");
  }

  const entry: DecisionEntry = {
    timestamp: new Date().toISOString(),
    stepId: params.stepId,
    type: params.type,
    description: params.description,
    rationale: params.rationale,
    researcherApproved: params.researcherApproved,
  };

  state.currentPlan.decisions.push(entry);
  state.currentPlan.updated = new Date().toISOString();

  return entry;
}

/**
 * Create or update a QC checkpoint
 */
export function setCheckpoint(params: {
  stepId: string;
  name: string;
  criteria: string[];
  status: CheckpointStatus;
  observations: string[];
}): QCCheckpoint {
  if (!state.currentPlan) {
    throw new Error("No active plan");
  }

  // Check if checkpoint already exists for this step
  let checkpoint = state.currentPlan.checkpoints.find(
    c => c.stepId === params.stepId && c.name === params.name
  );

  if (checkpoint) {
    // Update existing
    checkpoint.status = params.status;
    checkpoint.observations = params.observations;
    if (params.status !== 'pending') {
      checkpoint.reviewedAt = new Date().toISOString();
    }
  } else {
    // Create new
    checkpoint = {
      id: `qc-${state.currentPlan.checkpoints.length + 1}`,
      stepId: params.stepId,
      name: params.name,
      criteria: params.criteria,
      status: params.status,
      observations: params.observations,
      reviewedAt: params.status !== 'pending' ? new Date().toISOString() : undefined,
    };
    state.currentPlan.checkpoints.push(checkpoint);
  }

  state.currentPlan.updated = new Date().toISOString();
  return checkpoint;
}

/**
 * Update Galaxy connection state
 */
export function setGalaxyConnection(connected: boolean, historyId?: string, serverUrl?: string): void {
  state.galaxyConnected = connected;

  if (historyId) {
    state.currentHistoryId = historyId;
    if (state.currentPlan) {
      state.currentPlan.galaxy.historyId = historyId;
    }
  }

  if (serverUrl && state.currentPlan) {
    state.currentPlan.galaxy.serverUrl = serverUrl;
  }
}

/**
 * Format plan for context injection (compact summary)
 */
export function formatPlanSummary(plan: AnalysisPlan): string {
  const lines: string[] = [];

  // Header
  lines.push(`**${plan.title}** [${plan.status}]`);
  lines.push(`Research: ${plan.context.researchQuestion}`);

  // Galaxy context
  if (plan.galaxy.historyId) {
    lines.push(`History: ${plan.galaxy.historyName || plan.galaxy.historyId}`);
  }

  // Steps overview
  lines.push('');
  lines.push('**Steps:**');
  for (const step of plan.steps) {
    const icon = {
      'pending': '⬜',
      'in_progress': '🔄',
      'completed': '✅',
      'skipped': '⏭️',
      'failed': '❌',
    }[step.status];
    lines.push(`${icon} ${step.id}. ${step.name}`);
  }

  // Current step details
  const currentStep = plan.steps.find(s => s.status === 'in_progress');
  if (currentStep) {
    lines.push('');
    lines.push(`**Current: ${currentStep.name}**`);
    lines.push(currentStep.description);
  }

  // Recent decisions (last 3)
  if (plan.decisions.length > 0) {
    lines.push('');
    lines.push('**Recent Decisions:**');
    const recent = plan.decisions.slice(-3);
    for (const d of recent) {
      const truncated = d.description.length > 60
        ? d.description.slice(0, 60) + '...'
        : d.description;
      lines.push(`- [${d.type}] ${truncated}`);
    }
  }

  return lines.join('\n');
}
