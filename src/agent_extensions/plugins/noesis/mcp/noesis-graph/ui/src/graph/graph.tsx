import { useCallback, useEffect, useMemo, useState } from "react";
import { Box, Loader, Stack, Text } from "@mantine/core";
import {
  ReactFlow,
  Background,
  Controls,
  MiniMap,
  useNodesState,
  useEdgesState,
  MarkerType,
  type Node,
  type Edge,
  type NodeTypes,
  BackgroundVariant,
} from "@xyflow/react";
import { SchemaTableNode } from "./schema-table-node.js";

interface PropertySchema {
  name: string;
  type: string;
  isPrimaryKey: boolean;
}

interface NodeTableSchema {
  name: string;
  properties: PropertySchema[];
}

interface RelTableSchema {
  name: string;
  from: string;
  to: string;
  properties: PropertySchema[];
}

interface GraphSchema {
  nodeTables: NodeTableSchema[];
  relTables: RelTableSchema[];
}

const NODE_WIDTH = 260;
const NODE_BASE_HEIGHT = 60;
const PROPERTY_ROW_HEIGHT = 28;
const HORIZONTAL_GAP = 120;
const VERTICAL_GAP = 80;

export function GraphPage() {
  const [schema, setSchema] = useState<GraphSchema | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/graph/schema")
      .then((res) => res.json())
      .then((data: GraphSchema) => {
        setSchema(data);
        setLoading(false);
      })
      .catch((err) => {
        setError(err.message);
        setLoading(false);
      });
  }, []);

  if (loading) {
    return (
      <Stack align="center" justify="center" h="calc(100vh - 50px)">
        <Loader size="lg" />
        <Text c="dimmed">Loading schema...</Text>
      </Stack>
    );
  }

  if (error) {
    return (
      <Stack align="center" justify="center" h="calc(100vh - 50px)">
        <Text c="red.5">Failed to load schema: {error}</Text>
      </Stack>
    );
  }

  if (!schema || schema.nodeTables.length === 0) {
    return (
      <Stack align="center" justify="center" h="calc(100vh - 50px)">
        <Text c="dimmed" size="lg">
          No schema found. Scan your repository first.
        </Text>
      </Stack>
    );
  }

  return <SchemaGraph schema={schema} />;
}

const NODE_COLORS: Record<string, { bg: string; border: string; header: string }> = {
  BoundedContext: { bg: "#1a2744", border: "#4f8de2", header: "#1d4ed8" },
  Module: { bg: "#1a2e1f", border: "#4ade80", header: "#22b854" },
  BuildingBlock: { bg: "#261a35", border: "#9184ec", header: "#4f46e5" },
  CSharpNamespace: { bg: "#2b2217", border: "#d4a066", header: "#b97840" },
  CSharpType: { bg: "#2a1e2a", border: "#d27ed2", header: "#a643a6" },
};

const DEFAULT_COLOR = { bg: "#1f2937", border: "#6b7280", header: "#374151" };

function SchemaGraph({ schema }: { schema: GraphSchema }) {
  const nodeTypes: NodeTypes = useMemo(() => ({ schemaTable: SchemaTableNode }), []);

  const { initialNodes, initialEdges } = useMemo(
    () => buildFlowElements(schema),
    [schema],
  );

  const [nodes, , onNodesChange] = useNodesState(initialNodes);
  const [edges, , onEdgesChange] = useEdgesState(initialEdges);

  const [highlightedEdges, setHighlightedEdges] = useState<Set<string>>(new Set());
  const [highlightedNodes, setHighlightedNodes] = useState<Set<string>>(new Set());

  const onNodeMouseEnter = useCallback(
    (_: React.MouseEvent, node: Node) => {
      const connectedEdges = edges.filter(
        (e) => e.source === node.id || e.target === node.id,
      );
      const connectedNodeIds = new Set<string>();
      connectedNodeIds.add(node.id);
      for (const e of connectedEdges) {
        connectedNodeIds.add(e.source);
        connectedNodeIds.add(e.target);
      }
      setHighlightedEdges(new Set(connectedEdges.map((e) => e.id)));
      setHighlightedNodes(connectedNodeIds);
    },
    [edges],
  );

  const onNodeMouseLeave = useCallback(() => {
    setHighlightedEdges(new Set());
    setHighlightedNodes(new Set());
  }, []);

  const styledNodes = useMemo(
    () =>
      nodes.map((n) => ({
        ...n,
        data: {
          ...n.data,
          highlighted:
            highlightedNodes.size === 0 || highlightedNodes.has(n.id),
          dimmed: highlightedNodes.size > 0 && !highlightedNodes.has(n.id),
        },
      })),
    [nodes, highlightedNodes],
  );

  const styledEdges = useMemo(
    () =>
      edges.map((e) => ({
        ...e,
        style: {
          ...e.style,
          stroke:
            highlightedEdges.size > 0 && highlightedEdges.has(e.id)
              ? "#4f8de2"
              : highlightedEdges.size > 0
                ? "rgba(107,114,128,0.2)"
                : e.style?.stroke,
          strokeWidth:
            highlightedEdges.size > 0 && highlightedEdges.has(e.id) ? 2.5 : 1.5,
        },
        labelStyle: {
          ...((e.labelStyle as Record<string, unknown>) ?? {}),
          opacity:
            highlightedEdges.size > 0 && !highlightedEdges.has(e.id) ? 0.2 : 1,
        },
      })),
    [edges, highlightedEdges],
  );

  return (
    <Box style={{ width: "100%", height: "calc(100vh - 50px)" }}>
      <ReactFlow
        nodes={styledNodes}
        edges={styledEdges}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        onNodeMouseEnter={onNodeMouseEnter}
        onNodeMouseLeave={onNodeMouseLeave}
        nodeTypes={nodeTypes}
        fitView
        fitViewOptions={{ padding: 0.3 }}
        minZoom={0.3}
        maxZoom={2}
        proOptions={{ hideAttribution: true }}
      >
        <Background variant={BackgroundVariant.Dots} gap={20} size={1} color="rgba(255,255,255,0.05)" />
        <Controls
          showInteractive={false}
          style={{ backgroundColor: "#1f2937", borderColor: "#374151" }}
        />
        <MiniMap
          nodeColor={(n) => {
            const colors = NODE_COLORS[n.data?.tableName as string] ?? DEFAULT_COLOR;
            return colors.border;
          }}
          maskColor="rgba(0,0,0,0.7)"
          style={{ backgroundColor: "#111827" }}
        />
      </ReactFlow>
    </Box>
  );
}

function buildFlowElements(schema: GraphSchema): {
  initialNodes: Node[];
  initialEdges: Edge[];
} {
  const positions = layoutNodes(schema.nodeTables);
  const initialNodes: Node[] = schema.nodeTables.map((table) => {
    const colors = NODE_COLORS[table.name] ?? DEFAULT_COLOR;
    const pos = positions.get(table.name) ?? { x: 0, y: 0 };

    return {
      id: table.name,
      type: "schemaTable",
      position: pos,
      data: {
        tableName: table.name,
        properties: table.properties,
        colors,
        highlighted: true,
        dimmed: false,
      },
    };
  });

  const edgeCounts = new Map<string, number>();
  const initialEdges: Edge[] = schema.relTables.map((rel) => {
    const pairKey = [rel.from, rel.to].sort().join("::");
    const count = edgeCounts.get(pairKey) ?? 0;
    edgeCounts.set(pairKey, count + 1);

    const isSelfLoop = rel.from === rel.to;

    return {
      id: `${rel.name}-${rel.from}-${rel.to}-${count}`,
      source: rel.from,
      target: rel.to,
      label: formatRelName(rel.name),
      type: isSelfLoop ? "default" : "smoothstep",
      animated: false,
      markerEnd: { type: MarkerType.ArrowClosed, color: "#6b7280" },
      style: { stroke: "#6b7280", strokeWidth: 1.5 },
      labelStyle: { fill: "#9ca3af", fontSize: 11, fontWeight: 500 },
      labelBgStyle: { fill: "#111827", fillOpacity: 0.9 },
      labelBgPadding: [6, 3] as [number, number],
      labelBgBorderRadius: 4,
    };
  });

  return { initialNodes, initialEdges };
}

function layoutNodes(
  nodeTables: NodeTableSchema[],
): Map<string, { x: number; y: number }> {
  const positions = new Map<string, { x: number; y: number }>();
  const cols = Math.ceil(Math.sqrt(nodeTables.length));

  for (let i = 0; i < nodeTables.length; i++) {
    const col = i % cols;
    const row = Math.floor(i / cols);
    const nodeHeight =
      NODE_BASE_HEIGHT + nodeTables[i].properties.length * PROPERTY_ROW_HEIGHT;

    positions.set(nodeTables[i].name, {
      x: col * (NODE_WIDTH + HORIZONTAL_GAP),
      y: row * (nodeHeight + VERTICAL_GAP + 40),
    });
  }

  return positions;
}

function formatRelName(name: string): string {
  return name.replace(/_/g, " ").toLowerCase();
}
