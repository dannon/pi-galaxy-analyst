/**
 * Step graph rendered with React Flow + dagre layout.
 *
 * Mounted as a single React island inside the Steps tab; the rest of the
 * renderer stays vanilla TypeScript. The exported `StepGraph` class wraps
 * a React root and exposes the same `render(steps)` interface as the
 * previous SVG-based implementation, so app.ts only needs an import path
 * change.
 */

import { createRoot, type Root } from "react-dom/client";
import { useEffect, useState, useMemo, useCallback } from "react";
import {
  ReactFlow,
  Background,
  Controls,
  Handle,
  Position,
  type Node,
  type Edge,
  type NodeProps,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import dagre from "@dagrejs/dagre";

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

export interface Step {
  id: string;
  name: string;
  description: string;
  status: "pending" | "in_progress" | "completed" | "failed" | "skipped";
  dependsOn: string[];
  result?: string;
  command?: string;
  explanation?: string;
}

const STATUS_ICONS: Record<Step["status"], string> = {
  pending: "○",
  in_progress: "◐",
  completed: "●",
  failed: "✗",
  skipped: "◌",
};

// ─────────────────────────────────────────────────────────────────────────────
// Class wrapper — keeps the same interface as the old vanilla StepGraph
// ─────────────────────────────────────────────────────────────────────────────

export class StepGraph {
  private root: Root;
  private currentSteps: Step[] = [];
  private setStepsFn: ((s: Step[]) => void) | null = null;

  constructor(container: HTMLElement) {
    // Mount React into a CHILD div, not the container itself.
    // This avoids a CSS specificity collision: .tab-panel rules (display: none)
    // would otherwise be overridden by .step-graph-root (display: flex), causing
    // the steps tab to stay visible and overlap other tabs.
    container.innerHTML = "";
    const root = document.createElement("div");
    root.className = "step-graph-root";
    container.appendChild(root);

    this.root = createRoot(root);
    this.root.render(
      <StepGraphApp
        registerSetSteps={(fn) => {
          this.setStepsFn = fn;
          // Apply any steps that arrived before the React state was ready
          if (this.currentSteps.length > 0) fn(this.currentSteps);
        }}
      />
    );
  }

  render(steps: Step[]): void {
    this.currentSteps = steps;
    this.setStepsFn?.(steps);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// React component
// ─────────────────────────────────────────────────────────────────────────────

interface StepGraphAppProps {
  registerSetSteps: (fn: (s: Step[]) => void) => void;
}

function StepGraphApp({ registerSetSteps }: StepGraphAppProps) {
  const [steps, setSteps] = useState<Step[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);

  useEffect(() => {
    registerSetSteps(setSteps);
  }, [registerSetSteps]);

  const { nodes, edges } = useMemo(() => buildGraph(steps), [steps]);

  const selected = steps.find((s) => s.id === selectedId) ?? null;

  const onNodeClick = useCallback(
    (_evt: unknown, node: Node) => {
      setSelectedId((prev) => (prev === node.id ? null : node.id));
    },
    [],
  );

  if (steps.length === 0) {
    return <div className="empty-state">No steps yet.</div>;
  }

  return (
    <div className="step-graph-layout">
      <div className="step-graph-flow">
        <ReactFlow
          nodes={nodes}
          edges={edges}
          nodeTypes={NODE_TYPES}
          onNodeClick={onNodeClick}
          fitView
          fitViewOptions={{ padding: 0.15 }}
          proOptions={{ hideAttribution: true }}
          nodesDraggable={false}
          nodesConnectable={false}
          elementsSelectable
          minZoom={0.2}
          maxZoom={2}
        >
          <Background gap={16} />
          <Controls showInteractive={false} />
        </ReactFlow>
      </div>
      {selected && (
        <StepDetailPanel
          step={selected}
          onClose={() => setSelectedId(null)}
        />
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Custom node
// ─────────────────────────────────────────────────────────────────────────────

interface StepNodeData extends Record<string, unknown> {
  step: Step;
  selected: boolean;
}

function StepNode({ data }: NodeProps) {
  const { step, selected } = data as StepNodeData;
  const cls = `sg-node sg-${step.status}` + (selected ? " sg-selected" : "");
  return (
    <div className={cls}>
      <Handle
        type="target"
        position={Position.Top}
        style={{ visibility: "hidden" }}
      />
      <div className="sg-indicator">{STATUS_ICONS[step.status]}</div>
      <div className="sg-content">
        <div className="sg-title">{step.name}</div>
        <div className="sg-desc">{step.description}</div>
        {step.result && (
          <div className={`sg-result sg-result-${step.status}`}>
            {step.result}
          </div>
        )}
      </div>
      <Handle
        type="source"
        position={Position.Bottom}
        style={{ visibility: "hidden" }}
      />
    </div>
  );
}

const NODE_TYPES = { step: StepNode };

// ─────────────────────────────────────────────────────────────────────────────
// Side panel
// ─────────────────────────────────────────────────────────────────────────────

interface StepDetailPanelProps {
  step: Step;
  onClose: () => void;
}

function StepDetailPanel({ step, onClose }: StepDetailPanelProps) {
  return (
    <aside className="sg-detail-panel">
      <div className="sg-detail-header">
        <span className={`sg-detail-status sg-${step.status}`}>
          {step.status.replace("_", " ")}
        </span>
        <h3>{step.name}</h3>
        <button
          className="sg-detail-close"
          onClick={onClose}
          title="Close"
          aria-label="Close detail panel"
        >
          ×
        </button>
      </div>
      <div className="sg-detail-body">
        {step.description && (
          <section>
            <h4>Description</h4>
            <p>{step.description}</p>
          </section>
        )}
        {step.explanation && (
          <section>
            <h4>What it does</h4>
            <p>{step.explanation}</p>
          </section>
        )}
        {step.command && (
          <section>
            <h4>Command</h4>
            <pre className="sg-command">
              <code>{step.command}</code>
            </pre>
          </section>
        )}
        {step.result && (
          <section>
            <h4>Result</h4>
            <p>{step.result}</p>
          </section>
        )}
        {step.dependsOn.length > 0 && (
          <section>
            <h4>Depends on</h4>
            <p className="sg-deps">{step.dependsOn.join(", ")}</p>
          </section>
        )}
      </div>
    </aside>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Layout via dagre
// ─────────────────────────────────────────────────────────────────────────────

const NODE_W = 280;
const NODE_H = 110;  // approximate; dagre uses this for collision avoidance

function buildGraph(steps: Step[]): { nodes: Node[]; edges: Edge[] } {
  if (steps.length === 0) return { nodes: [], edges: [] };

  const stepIds = new Set(steps.map((s) => s.id));

  const g = new dagre.graphlib.Graph();
  g.setGraph({ rankdir: "TB", nodesep: 40, ranksep: 60, marginx: 20, marginy: 20 });
  g.setDefaultEdgeLabel(() => ({}));

  for (const step of steps) {
    g.setNode(step.id, { width: NODE_W, height: NODE_H });
  }
  for (const step of steps) {
    for (const dep of step.dependsOn) {
      if (stepIds.has(dep)) g.setEdge(dep, step.id);
    }
  }

  dagre.layout(g);

  const nodes: Node[] = steps.map((step) => {
    const pos = g.node(step.id);
    return {
      id: step.id,
      type: "step",
      position: { x: pos.x - NODE_W / 2, y: pos.y - NODE_H / 2 },
      data: { step, selected: false } satisfies StepNodeData,
      draggable: false,
    };
  });

  const edges: Edge[] = steps.flatMap((step) =>
    step.dependsOn
      .filter((dep) => stepIds.has(dep))
      .map((dep) => {
        const sourceStep = steps.find((s) => s.id === dep)!;
        const edgeColor =
          sourceStep.status === "completed"
            ? "var(--state-ok-border)"
            : sourceStep.status === "failed"
              ? "var(--state-error-border)"
              : "var(--border-strong)";
        return {
          id: `${dep}->${step.id}`,
          source: dep,
          target: step.id,
          type: "smoothstep",
          animated: sourceStep.status === "in_progress",
          style: { stroke: edgeColor, strokeWidth: 2 },
        } satisfies Edge;
      }),
  );

  return { nodes, edges };
}
