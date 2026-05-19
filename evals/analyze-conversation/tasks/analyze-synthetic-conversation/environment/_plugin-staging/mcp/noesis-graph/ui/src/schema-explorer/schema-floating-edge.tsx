import {
  EdgeLabelRenderer,
  getStraightPath,
  useInternalNode,
  type EdgeProps,
  type InternalNode,
} from "@xyflow/react";

const FALLBACK_DIAMETER = 130;

interface LabelStyle {
  fill?: string;
  fontSize?: number;
  fontWeight?: number;
  opacity?: number;
}

interface LabelBgStyle {
  fill?: string;
  fillOpacity?: number;
}

export function SchemaFloatingEdge({
  id,
  source,
  target,
  markerEnd,
  style,
  label,
  labelStyle,
  labelBgStyle,
  labelBgPadding,
  labelBgBorderRadius,
}: EdgeProps) {
  const sourceNode = useInternalNode(source);
  const targetNode = useInternalNode(target);
  if (sourceNode === undefined || targetNode === undefined) return null;

  const { sourceX, sourceY, targetX, targetY } = perimeterEndpoints(
    sourceNode,
    targetNode,
  );
  const [edgePath, labelX, labelY] = getStraightPath({
    sourceX,
    sourceY,
    targetX,
    targetY,
  });

  return (
    <>
      <path
        id={id}
        d={edgePath}
        markerEnd={markerEnd as string | undefined}
        style={style}
        fill="none"
        className="react-flow__edge-path"
      />
      <path
        d={edgePath}
        fill="none"
        strokeOpacity={0}
        strokeWidth={20}
        className="react-flow__edge-interaction"
      />
      {hasLabel(label) && (
        <EdgeLabelRenderer>
          <div
            className="nodrag nopan"
            style={labelWrapperStyle(
              labelX,
              labelY,
              labelStyle as LabelStyle | undefined,
              labelBgStyle as LabelBgStyle | undefined,
              labelBgPadding,
              labelBgBorderRadius,
            )}
          >
            {label}
          </div>
        </EdgeLabelRenderer>
      )}
    </>
  );
}

function hasLabel(label: unknown): label is React.ReactNode {
  return label !== undefined && label !== null && label !== "";
}

function labelWrapperStyle(
  x: number,
  y: number,
  text: LabelStyle | undefined,
  bg: LabelBgStyle | undefined,
  padding: [number, number] | number | undefined,
  borderRadius: number | undefined,
): React.CSSProperties {
  const padArr = Array.isArray(padding)
    ? padding
    : padding !== undefined
      ? [padding, padding]
      : [4, 2];
  return {
    position: "absolute",
    transform: `translate(-50%, -50%) translate(${x}px, ${y}px)`,
    color: text?.fill,
    fontSize: text?.fontSize,
    fontWeight: text?.fontWeight,
    opacity: text?.opacity,
    background: bg?.fill,
    padding: `${padArr[1]}px ${padArr[0]}px`,
    borderRadius,
    pointerEvents: "none",
    whiteSpace: "nowrap",
  };
}

function perimeterEndpoints(
  source: InternalNode,
  target: InternalNode,
): { sourceX: number; sourceY: number; targetX: number; targetY: number } {
  const sc = nodeCenter(source);
  const tc = nodeCenter(target);
  const dx = tc.x - sc.x;
  const dy = tc.y - sc.y;
  const dist = Math.sqrt(dx * dx + dy * dy);
  if (dist < 0.0001) {
    return { sourceX: sc.x, sourceY: sc.y, targetX: tc.x, targetY: tc.y };
  }
  const ux = dx / dist;
  const uy = dy / dist;
  const rs = nodeRadius(source);
  const rt = nodeRadius(target);
  return {
    sourceX: sc.x + ux * rs,
    sourceY: sc.y + uy * rs,
    targetX: tc.x - ux * rt,
    targetY: tc.y - uy * rt,
  };
}

function nodeCenter(node: InternalNode): { x: number; y: number } {
  const width = node.measured?.width ?? FALLBACK_DIAMETER;
  const height = node.measured?.height ?? FALLBACK_DIAMETER;
  const pos = node.internals.positionAbsolute ?? node.position;
  return { x: pos.x + width / 2, y: pos.y + height / 2 };
}

function nodeRadius(node: InternalNode): number {
  const width = node.measured?.width ?? FALLBACK_DIAMETER;
  const height = node.measured?.height ?? FALLBACK_DIAMETER;
  return Math.min(width, height) / 2;
}
