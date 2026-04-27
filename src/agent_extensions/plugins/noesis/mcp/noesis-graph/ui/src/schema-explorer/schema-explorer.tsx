import { useCallback, useEffect, useMemo, useState } from "react";
import { ActionIcon, Loader, Stack, Text } from "@mantine/core";
import {
  Background,
  BackgroundVariant,
  Controls,
  MarkerType,
  MiniMap,
  NodeToolbar,
  Position,
  ReactFlow,
  useEdgesState,
  useNodesState,
  useReactFlow,
  type Edge,
  type EdgeTypes,
  type Node,
  type NodeTypes,
} from "@xyflow/react";
import { IconArrowRight, IconKey, IconX } from "@tabler/icons-react";
import { SchemaNode, type SchemaNodeData } from "./schema-node.js";
import { SchemaFloatingEdge } from "./schema-floating-edge.js";
import { SchemaSelfLoopEdge } from "./schema-self-loop-edge.js";
import classes from "./schema-explorer.module.css";
import type {
  NodeTableSchema,
  PropertySchema,
  RelTableSchema,
  SchemaExplorerData,
} from "../../../ui-contracts/schema-explorer/schema-explorer-data.js";

type SelectionRef =
  | { kind: "node"; id: string }
  | { kind: "edge"; id: string }
  | null;

const NODE_DIAMETER = 130;
const MINIMAP_NODE_COLOR = "#4a5570";
const REL_VERBS = new Set([
  "HAS",
  "CONTAINS",
  "INVOKES",
  "REPRESENTED",
  "SUPPORTED",
  "TRIGGERED",
  "BELONGS",
  "IS",
  "IN",
  "ASSOCIATED",
  "LINKED",
  "CONNECTED",
]);

export function SchemaExplorerPage() {
  const [schema, setSchema] = useState<SchemaExplorerData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/ui/schema-explorer")
      .then((res) => res.json())
      .then((data: SchemaExplorerData) => {
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
        <Loader size="lg" color="noesisBlue" />
        <Text c="dimmed">Loading schema...</Text>
      </Stack>
    );
  }

  if (error !== null) {
    return (
      <Stack align="center" justify="center" h="calc(100vh - 50px)">
        <Text c="red.5">Failed to load schema: {error}</Text>
      </Stack>
    );
  }

  if (schema === null || schema.nodeTables.length === 0) {
    return (
      <Stack align="center" justify="center" h="calc(100vh - 50px)">
        <Text c="dimmed" size="lg">
          No schema found. Scan your repository first.
        </Text>
      </Stack>
    );
  }

  return <SchemaExplorerCanvas schema={schema} />;
}

function SchemaExplorerCanvas({ schema }: { schema: SchemaExplorerData }) {
  const [selection, setSelection] = useState<SelectionRef>(null);
  const { fitView } = useReactFlow();

  const nodeTypes: NodeTypes = useMemo(
    () => ({ schemaNode: SchemaNode }),
    [],
  );
  const edgeTypes: EdgeTypes = useMemo(
    () => ({
      schemaFloating: SchemaFloatingEdge,
      schemaSelfLoop: SchemaSelfLoopEdge,
    }),
    [],
  );

  const { initialNodes, initialEdges, nodeIndex, edgeIndex } = useMemo(
    () => buildFlowElements(schema),
    [schema],
  );

  const [nodes, setNodes, onNodesChange] = useNodesState<Node>(initialNodes);
  const [edges, setEdges, onEdgesChange] = useEdgesState<Edge>(initialEdges);

  useEffect(() => {
    setNodes(initialNodes);
  }, [initialNodes, setNodes]);

  useEffect(() => {
    setEdges(initialEdges);
  }, [initialEdges, setEdges]);

  const active = useMemo(
    () => activeIds(selection, edgeIndex),
    [selection, edgeIndex],
  );

  useEffect(() => {
    setNodes((current) =>
      current.map((n) => {
        const data = n.data as SchemaNodeData;
        const nextSelected =
          selection?.kind === "node" && selection.id === n.id;
        const nextDimmed = active !== null && !active.nodes.has(n.id);
        if (data.selected === nextSelected && data.dimmed === nextDimmed) {
          return n;
        }
        return {
          ...n,
          data: { ...data, selected: nextSelected, dimmed: nextDimmed },
        };
      }),
    );
  }, [selection, active, setNodes]);

  useEffect(() => {
    setEdges((current) =>
      current.map((e) => {
        const isActive = active === null || active.edges.has(e.id);
        const isSelected = selection?.kind === "edge" && selection.id === e.id;
        const stroke = isSelected
          ? "#74a4e8"
          : isActive
            ? "#7c8fb0"
            : "rgba(124, 143, 176, 0.22)";
        const strokeWidth = isSelected ? 2.4 : 1.6;
        const markerColor = isSelected
          ? "#74a4e8"
          : isActive
            ? "#a8b4c8"
            : "rgba(168, 180, 200, 0.25)";
        return {
          ...e,
          style: { stroke, strokeWidth },
          markerEnd: {
            type: MarkerType.ArrowClosed,
            color: markerColor,
            width: 16,
            height: 16,
          },
          labelStyle: {
            ...((e.labelStyle as Record<string, unknown>) ?? {}),
            opacity: isActive ? 1 : 0.2,
          },
        };
      }),
    );
  }, [selection, active, setEdges]);

  useEffect(() => {
    const timers = [30, 140, 360].map((delay) =>
      window.setTimeout(() => {
        fitView({ padding: 0.2, duration: delay === 30 ? 0 : 220 });
      }, delay),
    );
    return () => {
      timers.forEach((t) => window.clearTimeout(t));
    };
  }, [fitView, initialNodes.length, initialEdges.length]);

  const onNodeClick = useCallback((_: React.MouseEvent, node: Node) => {
    setSelection({ kind: "node", id: node.id });
  }, []);

  const onEdgeClick = useCallback((_: React.MouseEvent, edge: Edge) => {
    setSelection({ kind: "edge", id: edge.id });
  }, []);

  const onPaneClick = useCallback(() => setSelection(null), []);
  const closePopup = useCallback(() => setSelection(null), []);

  const popupAnchor = anchorNodeId(selection, edgeIndex);

  return (
    <div className={classes.shell}>
      <ReactFlow
        nodes={nodes}
        edges={edges}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        onNodeClick={onNodeClick}
        onEdgeClick={onEdgeClick}
        onPaneClick={onPaneClick}
        nodeTypes={nodeTypes}
        edgeTypes={edgeTypes}
        nodesConnectable={false}
        nodesDraggable
        fitView
        fitViewOptions={{ padding: 0.2 }}
        minZoom={0.05}
        maxZoom={2}
        proOptions={{ hideAttribution: true }}
      >
        <Background
          variant={BackgroundVariant.Dots}
          gap={20}
          size={1}
          color="rgba(148, 163, 184, 0.16)"
        />
        <Controls
          showInteractive={false}
          style={{
            backgroundColor: "var(--mantine-color-dark-6)",
            borderColor: "var(--mantine-color-dark-4)",
          }}
        />
        <MiniMap
          nodeColor={() => MINIMAP_NODE_COLOR}
          maskColor="rgba(0,0,0,0.7)"
          style={{ backgroundColor: "var(--mantine-color-dark-7)" }}
        />
        {popupAnchor !== null && (
          <NodeToolbar
            nodeId={popupAnchor}
            isVisible
            position={Position.Right}
            offset={16}
          >
            <SelectionPopup
              selection={selection}
              nodeIndex={nodeIndex}
              edgeIndex={edgeIndex}
              onClose={closePopup}
            />
          </NodeToolbar>
        )}
      </ReactFlow>
    </div>
  );
}

function SelectionPopup({
  selection,
  nodeIndex,
  edgeIndex,
  onClose,
}: {
  selection: SelectionRef;
  nodeIndex: Map<string, NodeTableSchema>;
  edgeIndex: Map<string, RelTableSchema>;
  onClose: () => void;
}) {
  const content = renderSelection(selection, nodeIndex, edgeIndex);
  if (content === null) return null;
  return (
    <div className={classes.popover}>
      <div className={classes.popoverHeader}>
        {content.swatch}
        <div className={classes.popoverTitle}>
          <span className={classes.popoverKindLabel}>{content.kindLabel}</span>
          <span className={classes.popoverName}>{content.name}</span>
        </div>
        <ActionIcon
          variant="subtle"
          color="gray"
          size="sm"
          className={classes.popoverClose}
          onClick={onClose}
          aria-label="Close details"
        >
          <IconX size={14} stroke={1.8} />
        </ActionIcon>
      </div>
      <div className={classes.popoverBody}>{content.body}</div>
    </div>
  );
}

function renderSelection(
  selection: SelectionRef,
  nodeIndex: Map<string, NodeTableSchema>,
  edgeIndex: Map<string, RelTableSchema>,
): {
  kindLabel: string;
  name: string;
  swatch: React.ReactNode;
  body: React.ReactNode;
} | null {
  if (selection === null) return null;
  switch (selection.kind) {
    case "node": {
      const table = nodeIndex.get(selection.id);
      if (!table) return null;
      return {
        kindLabel: "Node table",
        name: table.name,
        swatch: <span className={classes.popoverSwatch} />,
        body: <PropertyList properties={table.properties} />,
      };
    }
    case "edge": {
      const rel = edgeIndex.get(selection.id);
      if (!rel) return null;
      return {
        kindLabel: "Relationship",
        name: rel.name,
        swatch: null,
        body: (
          <>
            <div>
              <div className={classes.sectionLabel}>Endpoints</div>
              <div className={classes.endpointRow}>
                <span className={classes.endpointName}>{rel.from}</span>
                <IconArrowRight
                  size={14}
                  stroke={2}
                  className={classes.endpointArrow}
                />
                <span className={classes.endpointName}>{rel.to}</span>
              </div>
            </div>
            <PropertyList
              properties={rel.properties}
              emptyLabel="No properties"
            />
          </>
        ),
      };
    }
    default:
      return assertNever(selection);
  }
}

function PropertyList({
  properties,
  emptyLabel = "No properties",
}: {
  properties: PropertySchema[];
  emptyLabel?: string;
}) {
  if (properties.length === 0) {
    return (
      <div>
        <div className={classes.sectionLabel}>Properties</div>
        <div className={classes.emptyMuted}>{emptyLabel}</div>
      </div>
    );
  }
  return (
    <div>
      <div className={classes.sectionLabel}>Properties</div>
      <div className={classes.propertyList}>
        {properties.map((prop) => (
          <div key={prop.name} className={classes.propertyRow}>
            {prop.isPrimaryKey && (
              <IconKey
                size={12}
                stroke={2}
                color="var(--mantine-color-yellow-5)"
              />
            )}
            <span
              className={`${classes.propertyName} ${
                prop.isPrimaryKey ? classes.propertyNamePk : ""
              }`}
            >
              {prop.name}
            </span>
            <span className={classes.propertyTypeBadge}>{prop.type}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

function activeIds(
  selection: SelectionRef,
  edgeIndex: Map<string, RelTableSchema>,
): { nodes: Set<string>; edges: Set<string> } | null {
  if (selection === null) return null;
  switch (selection.kind) {
    case "node": {
      const activeNodes = new Set<string>([selection.id]);
      const activeEdges = new Set<string>();
      for (const [edgeId, rel] of edgeIndex) {
        if (rel.from === selection.id || rel.to === selection.id) {
          activeEdges.add(edgeId);
          activeNodes.add(rel.from);
          activeNodes.add(rel.to);
        }
      }
      return { nodes: activeNodes, edges: activeEdges };
    }
    case "edge": {
      const rel = edgeIndex.get(selection.id);
      if (!rel) return null;
      return {
        nodes: new Set([rel.from, rel.to]),
        edges: new Set([selection.id]),
      };
    }
    default:
      return assertNever(selection);
  }
}

function anchorNodeId(
  selection: SelectionRef,
  edgeIndex: Map<string, RelTableSchema>,
): string | null {
  if (selection === null) return null;
  switch (selection.kind) {
    case "node":
      return selection.id;
    case "edge": {
      const rel = edgeIndex.get(selection.id);
      return rel?.to ?? null;
    }
    default:
      return assertNever(selection);
  }
}

function buildFlowElements(schema: SchemaExplorerData): {
  initialNodes: Node[];
  initialEdges: Edge[];
  nodeIndex: Map<string, NodeTableSchema>;
  edgeIndex: Map<string, RelTableSchema>;
} {
  const positions = forceLayout(schema.nodeTables, schema.relTables);
  const nodeIndex = new Map<string, NodeTableSchema>();
  for (const t of schema.nodeTables) nodeIndex.set(t.name, t);

  const initialNodes: Node[] = schema.nodeTables.map((table, i) => {
    const pos = positions.get(table.name) ?? { x: 0, y: 0 };
    const data: SchemaNodeData = {
      tableName: table.name,
      displayName: formatTableName(table.name),
      selected: false,
      dimmed: false,
      animationDelayMs: 40 + i * 22,
    };
    return {
      id: table.name,
      type: "schemaNode",
      position: pos,
      width: NODE_DIAMETER,
      height: NODE_DIAMETER,
      data,
    };
  });

  const edgeIndex = new Map<string, RelTableSchema>();
  const edgeCounts = new Map<string, number>();
  const initialEdges: Edge[] = schema.relTables.map((rel) => {
    const pairKey = `${rel.from}::${rel.to}::${rel.name}`;
    const count = edgeCounts.get(pairKey) ?? 0;
    edgeCounts.set(pairKey, count + 1);
    const id = `${rel.name}-${rel.from}-${rel.to}-${count}`;
    edgeIndex.set(id, rel);
    const isSelfLoop = rel.from === rel.to;
    return {
      id,
      source: rel.from,
      target: rel.to,
      label: formatRelLabel(rel.name),
      type: isSelfLoop ? "schemaSelfLoop" : "schemaFloating",
      animated: false,
      markerEnd: {
        type: MarkerType.ArrowClosed,
        color: "#a8b4c8",
        width: 16,
        height: 16,
      },
      style: { stroke: "#7c8fb0", strokeWidth: 1.6 },
      labelStyle: {
        fill: "var(--mantine-color-gray-4)",
        fontSize: 10,
        fontWeight: 500,
      },
      labelBgStyle: { fill: "#0c1428", fillOpacity: 0.85 },
      labelBgPadding: [6, 3] as [number, number],
      labelBgBorderRadius: 4,
    };
  });

  return { initialNodes, initialEdges, nodeIndex, edgeIndex };
}

function forceLayout(
  nodes: NodeTableSchema[],
  rels: RelTableSchema[],
): Map<string, { x: number; y: number }> {
  if (nodes.length === 0) return new Map();
  if (nodes.length === 1) {
    return new Map([[nodes[0].name, { x: 0, y: 0 }]]);
  }
  const components = findConnectedComponents(nodes, rels);
  const componentLayouts = components.map((componentIds, i) =>
    layoutComponent(
      componentIds,
      rels.filter((r) => componentIds.has(r.from) && componentIds.has(r.to)),
      0xcafef00d + i * 17,
    ),
  );
  return packComponentsRow(componentLayouts);
}

function findConnectedComponents(
  nodes: NodeTableSchema[],
  rels: RelTableSchema[],
): Array<Set<string>> {
  const adj = new Map<string, Set<string>>();
  for (const node of nodes) adj.set(node.name, new Set());
  for (const r of rels) {
    if (r.from === r.to) continue;
    adj.get(r.from)?.add(r.to);
    adj.get(r.to)?.add(r.from);
  }
  const visited = new Set<string>();
  const components: Array<Set<string>> = [];
  for (const node of nodes) {
    if (visited.has(node.name)) continue;
    const component = new Set<string>();
    const queue: string[] = [node.name];
    while (queue.length > 0) {
      const cur = queue.shift()!;
      if (visited.has(cur)) continue;
      visited.add(cur);
      component.add(cur);
      for (const nb of adj.get(cur) ?? []) {
        if (!visited.has(nb)) queue.push(nb);
      }
    }
    components.push(component);
  }
  components.sort((a, b) => b.size - a.size);
  return components;
}

function layoutComponent(
  componentIds: Set<string>,
  rels: RelTableSchema[],
  seed: number,
): Map<string, { x: number; y: number }> {
  const ids = Array.from(componentIds);
  const n = ids.length;
  const positions = new Map<string, { x: number; y: number }>();
  if (n === 1) {
    positions.set(ids[0], { x: 0, y: 0 });
    return positions;
  }

  const area = 90_000 * Math.max(n, 4);
  const k = Math.sqrt(area / n);
  const random = mulberry32(seed);

  for (let i = 0; i < n; i++) {
    const angle = (i / n) * Math.PI * 2;
    const radius = Math.sqrt(area) / 4;
    positions.set(ids[i], {
      x: Math.cos(angle) * radius + (random() - 0.5) * 20,
      y: Math.sin(angle) * radius + (random() - 0.5) * 20,
    });
  }

  const edgePairs: Array<[string, string]> = [];
  const seen = new Set<string>();
  for (const r of rels) {
    if (r.from === r.to) continue;
    const key =
      r.from < r.to ? `${r.from}|${r.to}` : `${r.to}|${r.from}`;
    if (seen.has(key)) continue;
    seen.add(key);
    edgePairs.push([r.from, r.to]);
  }

  let temperature = Math.sqrt(area) / 6;
  const iterations = 400;
  const gravity = 0.06;

  for (let iter = 0; iter < iterations; iter++) {
    const disp = new Map<string, { x: number; y: number }>();
    for (const id of ids) disp.set(id, { x: 0, y: 0 });

    for (let i = 0; i < n; i++) {
      for (let j = i + 1; j < n; j++) {
        const a = ids[i];
        const b = ids[j];
        const pa = positions.get(a)!;
        const pb = positions.get(b)!;
        let dx = pa.x - pb.x;
        let dy = pa.y - pb.y;
        let dist = Math.sqrt(dx * dx + dy * dy);
        if (dist < 0.01) {
          dx = (random() - 0.5) * 0.5;
          dy = (random() - 0.5) * 0.5;
          dist = Math.sqrt(dx * dx + dy * dy);
        }
        const force = (k * k) / dist;
        const da = disp.get(a)!;
        const db = disp.get(b)!;
        da.x += (dx / dist) * force;
        da.y += (dy / dist) * force;
        db.x -= (dx / dist) * force;
        db.y -= (dy / dist) * force;
      }
    }

    for (const [src, tgt] of edgePairs) {
      const pa = positions.get(src)!;
      const pb = positions.get(tgt)!;
      const dx = pa.x - pb.x;
      const dy = pa.y - pb.y;
      const dist = Math.sqrt(dx * dx + dy * dy);
      if (dist < 0.01) continue;
      const force = (dist * dist) / k;
      const da = disp.get(src)!;
      const db = disp.get(tgt)!;
      da.x -= (dx / dist) * force;
      da.y -= (dy / dist) * force;
      db.x += (dx / dist) * force;
      db.y += (dy / dist) * force;
    }

    for (const id of ids) {
      const p = positions.get(id)!;
      const d = disp.get(id)!;
      d.x -= p.x * gravity;
      d.y -= p.y * gravity;
      const dist = Math.sqrt(d.x * d.x + d.y * d.y);
      if (dist > 0) {
        const limit = Math.min(dist, temperature);
        p.x += (d.x / dist) * limit;
        p.y += (d.y / dist) * limit;
      }
    }

    temperature *= 0.96;
  }

  return positions;
}

function packComponentsRow(
  layouts: Array<Map<string, { x: number; y: number }>>,
): Map<string, { x: number; y: number }> {
  const COMPONENT_GAP = 220;
  const result = new Map<string, { x: number; y: number }>();
  const boxes = layouts.map(boundingBox);
  const totalWidth =
    boxes.reduce((sum, b) => sum + b.width, 0) +
    Math.max(0, layouts.length - 1) * COMPONENT_GAP;

  let cursor = -totalWidth / 2;
  layouts.forEach((layout, idx) => {
    const box = boxes[idx];
    const dx = cursor - box.minX;
    const dy = -(box.minY + box.maxY) / 2;
    for (const [id, p] of layout) {
      result.set(id, { x: p.x + dx, y: p.y + dy });
    }
    cursor += box.width + COMPONENT_GAP;
  });
  return result;
}

function boundingBox(layout: Map<string, { x: number; y: number }>): {
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
  width: number;
  height: number;
} {
  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;
  for (const p of layout.values()) {
    if (p.x < minX) minX = p.x;
    if (p.x > maxX) maxX = p.x;
    if (p.y < minY) minY = p.y;
    if (p.y > maxY) maxY = p.y;
  }
  if (!Number.isFinite(minX)) {
    return { minX: 0, maxX: 0, minY: 0, maxY: 0, width: 0, height: 0 };
  }
  return {
    minX,
    maxX,
    minY,
    maxY,
    width: Math.max(1, maxX - minX),
    height: Math.max(1, maxY - minY),
  };
}

function mulberry32(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function formatRelLabel(name: string): string {
  const parts = name.split("_");
  const verbIdx = parts.findIndex((p) => REL_VERBS.has(p));
  const startIdx = verbIdx >= 0 ? verbIdx : 0;
  return parts.slice(startIdx).join(" ").toLowerCase();
}

function formatTableName(name: string): string {
  return name.replace(/([a-z])([A-Z])/g, "$1 $2");
}

function assertNever(value: never): never {
  throw new Error(`unreachable variant: ${JSON.stringify(value)}`);
}
