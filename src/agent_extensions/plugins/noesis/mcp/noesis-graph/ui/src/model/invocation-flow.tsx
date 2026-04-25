import { memo, useEffect, useMemo, useState } from "react";
import { Group, Loader, Tooltip } from "@mantine/core";
import {
  Background,
  BackgroundVariant,
  Handle,
  MarkerType,
  Position,
  ReactFlow,
  useReactFlow,
  type Edge,
  type Node,
  type NodeProps,
  type NodeTypes,
} from "@xyflow/react";
import { IconBolt } from "@tabler/icons-react";
import { blockTypeStyle, type BehaviorMeta } from "./block-type.js";
import type { InvocationGraphData } from "./invocation-graph-data.js";
import classes from "./invocation-flow.module.css";

interface BlockGroup {
  blockId: string;
  blockName: string;
  blockType: string;
  behaviorNames: string[];
}

interface BlockFlowNodeData extends Record<string, unknown> {
  blockName: string;
  blockType: string;
  behaviorNames: string[];
  highlightBehavior: string | null;
  role: "caller" | "focused" | "callee";
  animationDelayMs: number;
}

const COLUMN_CALLER_X = -320;
const COLUMN_FOCUSED_X = 0;
const COLUMN_CALLEE_X = 320;

const NODE_WIDTH = 230;
const FOCUSED_NODE_WIDTH = 260;
const ROW_HEIGHT = 24;
const NODE_HEADER_HEIGHT = 48;
const NODE_PADDING_V = 12;
const COLUMN_GAP = 20;

export function InvocationFlow({ focus }: { focus: BehaviorMeta }) {
  const [data, setData] = useState<InvocationGraphData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    fetch(
      `/api/ui/invocation-graph?behaviorId=${encodeURIComponent(focus.id)}`,
    )
      .then((r) => r.json() as Promise<InvocationGraphData>)
      .then((result) => {
        if (cancelled) return;
        setData(result);
        setLoading(false);
      })
      .catch((err: Error) => {
        if (cancelled) return;
        setError(err.message);
        setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [focus.id]);

  const nodeTypes: NodeTypes = useMemo(
    () => ({ blockNode: BlockFlowNode }),
    [],
  );

  const { nodes, edges, isEmpty } = useMemo(
    () =>
      data === null
        ? { nodes: [] as Node[], edges: [] as Edge[], isEmpty: true }
        : buildFlowGraph(data),
    [data],
  );

  if (loading) {
    return (
      <div className={classes.shell}>
        <div className={classes.emptyState}>
          <Group gap={8} align="center">
            <Loader size={14} color="noesisBlue" />
            <span className={classes.emptyText}>Resolving invocations</span>
          </Group>
        </div>
      </div>
    );
  }

  if (error !== null) {
    return (
      <div className={classes.shell}>
        <div
          className={classes.emptyState}
          style={{ color: "var(--mantine-color-red-4)" }}
        >
          <span className={classes.emptyText}>{error}</span>
        </div>
      </div>
    );
  }

  if (isEmpty) {
    return (
      <div className={classes.shell}>
        <div className={classes.emptyState}>
          <span className={classes.emptyText}>No invocations discovered yet</span>
        </div>
      </div>
    );
  }

  return (
    <div className={classes.shell}>
      <FlowCanvas
        focusId={focus.id}
        nodes={nodes}
        edges={edges}
        nodeTypes={nodeTypes}
      />
    </div>
  );
}

function FlowCanvas({
  focusId,
  nodes,
  edges,
  nodeTypes,
}: {
  focusId: string;
  nodes: Node[];
  edges: Edge[];
  nodeTypes: NodeTypes;
}) {
  const { fitView } = useReactFlow();

  useEffect(() => {
    const timers = [30, 140, 360].map((delay) =>
      window.setTimeout(() => {
        fitView({ padding: 0.14, duration: delay === 30 ? 0 : 220 });
      }, delay),
    );
    return () => {
      timers.forEach((t) => window.clearTimeout(t));
    };
  }, [focusId, nodes.length, edges.length, fitView]);

  return (
    <ReactFlow
      nodes={nodes}
      edges={edges}
      nodeTypes={nodeTypes}
      nodesDraggable={false}
      nodesConnectable={false}
      nodesFocusable={false}
      edgesFocusable={false}
      panOnScroll={false}
      zoomOnScroll={false}
      zoomOnPinch={false}
      zoomOnDoubleClick={false}
      fitView
      fitViewOptions={{ padding: 0.14, minZoom: 0.3, maxZoom: 1.05 }}
      minZoom={0.25}
      maxZoom={1.4}
      proOptions={{ hideAttribution: true }}
    >
      <Background
        variant={BackgroundVariant.Dots}
        gap={18}
        size={1}
        color="rgba(148, 163, 184, 0.16)"
      />
    </ReactFlow>
  );
}

const BlockFlowNode = memo(function BlockFlowNode({ data }: NodeProps) {
  const {
    blockName,
    blockType,
    behaviorNames,
    highlightBehavior,
    role,
    animationDelayMs,
  } = data as BlockFlowNodeData;
  const { color } = blockTypeStyle(blockType);
  const focused = role === "focused";

  return (
    <div
      className={`${classes.node} ${focused ? classes.nodeFocused : ""}`}
      style={{
        width: focused ? FOCUSED_NODE_WIDTH : NODE_WIDTH,
        animationDelay: `${animationDelayMs}ms`,
      }}
    >
      {(role === "callee" || role === "focused") && (
        <Handle type="target" position={Position.Left} isConnectable={false} />
      )}
      {(role === "caller" || role === "focused") && (
        <Handle type="source" position={Position.Right} isConnectable={false} />
      )}

      <div className={classes.nodeHeader}>
        <Tooltip
          label={blockName}
          position="top"
          withArrow
          openDelay={350}
          transitionProps={{ duration: 120 }}
        >
          <span className={classes.nodeBlockName}>{blockName}</span>
        </Tooltip>
        <span
          className={classes.nodeBlockType}
          style={{ color: `var(--mantine-color-${color}-3)` }}
        >
          <span
            className={classes.nodeTypeDot}
            style={{ backgroundColor: `var(--mantine-color-${color}-5)` }}
          />
          {blockType}
        </span>
      </div>
      <div className={classes.nodeBehaviors}>
        {behaviorNames.map((name) => (
          <div
            key={name}
            className={
              highlightBehavior === name
                ? `${classes.behaviorLine} ${classes.behaviorLineFocused}`
                : classes.behaviorLine
            }
          >
            <IconBolt size={12} stroke={1.8} className={classes.behaviorIcon} />
            <span className={classes.behaviorName} title={name}>
              {name}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
});

function buildFlowGraph(data: InvocationGraphData): {
  nodes: Node[];
  edges: Edge[];
  isEmpty: boolean;
} {
  const { focus, callers, callees } = data;

  const callerGroups = groupByBlock(callers);
  const calleeGroups = groupByBlock(callees);

  const focusNodeIdValue = focusBlockNodeId(focus.blockId);
  const focusHeight = estimateHeight(1);

  const nodes: Node[] = [
    {
      id: focusNodeIdValue,
      type: "blockNode",
      position: { x: COLUMN_FOCUSED_X, y: -focusHeight / 2 },
      data: {
        blockName: focus.blockName,
        blockType: focus.blockType,
        behaviorNames: [focus.name],
        highlightBehavior: focus.name,
        role: "focused",
        animationDelayMs: 60,
      } as BlockFlowNodeData,
      draggable: false,
      selectable: false,
    },
  ];

  const edges: Edge[] = [];

  layoutColumn(callerGroups, COLUMN_CALLER_X, "caller", 160).forEach(
    (node, i) => {
      nodes.push(node);
      edges.push(buildEdge(node.id, focusNodeIdValue, `in-${i}`));
    },
  );

  layoutColumn(calleeGroups, COLUMN_CALLEE_X, "callee", 220).forEach(
    (node, i) => {
      nodes.push(node);
      edges.push(buildEdge(focusNodeIdValue, node.id, `out-${i}`));
    },
  );

  return {
    nodes,
    edges,
    isEmpty: callerGroups.length === 0 && calleeGroups.length === 0,
  };
}

function groupByBlock(behaviors: BehaviorMeta[]): BlockGroup[] {
  const map = new Map<string, BlockGroup>();
  for (const behavior of behaviors) {
    let group = map.get(behavior.blockId);
    if (group === undefined) {
      group = {
        blockId: behavior.blockId,
        blockName: behavior.blockName,
        blockType: behavior.blockType,
        behaviorNames: [],
      };
      map.set(behavior.blockId, group);
    }
    if (!group.behaviorNames.includes(behavior.name)) {
      group.behaviorNames.push(behavior.name);
    }
  }
  return Array.from(map.values());
}

function layoutColumn(
  groups: BlockGroup[],
  x: number,
  role: "caller" | "callee",
  baseDelayMs: number,
): Node[] {
  const heights = groups.map((g) => estimateHeight(g.behaviorNames.length));
  const totalHeight =
    heights.reduce((a, b) => a + b, 0) +
    Math.max(0, groups.length - 1) * COLUMN_GAP;
  let y = -totalHeight / 2;

  return groups.map((group, i) => {
    const node: Node = {
      id: columnNodeId(role, group.blockId),
      type: "blockNode",
      position: { x, y },
      data: {
        blockName: group.blockName,
        blockType: group.blockType,
        behaviorNames: group.behaviorNames,
        highlightBehavior: null,
        role,
        animationDelayMs: baseDelayMs + i * 55,
      } as BlockFlowNodeData,
      draggable: false,
      selectable: false,
    };
    y += heights[i] + COLUMN_GAP;
    return node;
  });
}

function estimateHeight(behaviorCount: number): number {
  return NODE_PADDING_V * 2 + NODE_HEADER_HEIGHT + behaviorCount * ROW_HEIGHT;
}

function buildEdge(source: string, target: string, suffix: string): Edge {
  return {
    id: `edge-${suffix}-${source}-${target}`,
    source,
    target,
    type: "smoothstep",
    style: { stroke: "#7c8fb0", strokeWidth: 1.6 },
    markerEnd: {
      type: MarkerType.ArrowClosed,
      color: "#a8b4c8",
      width: 16,
      height: 16,
    },
  } satisfies Edge;
}

function focusBlockNodeId(blockId: string): string {
  return `focus:${blockId}`;
}

function columnNodeId(role: "caller" | "callee", blockId: string): string {
  return `${role}:${blockId}`;
}
