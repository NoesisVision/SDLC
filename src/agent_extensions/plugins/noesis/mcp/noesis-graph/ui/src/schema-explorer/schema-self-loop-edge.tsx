import {
  EdgeLabelRenderer,
  useInternalNode,
  type EdgeProps,
  type InternalNode,
} from "@xyflow/react";

const FALLBACK_DIAMETER = 130;
const LOOP_RADIUS = 26;
const ANCHOR_ANGLE = Math.PI / 8;

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

export function SchemaSelfLoopEdge({
  id,
  source,
  markerEnd,
  style,
  label,
  labelStyle,
  labelBgStyle,
  labelBgPadding,
  labelBgBorderRadius,
}: EdgeProps) {
  const node = useInternalNode(source);
  if (node === undefined) return null;

  const center = nodeCenter(node);
  const radius = nodeRadius(node);
  const start = {
    x: center.x + radius * Math.cos(-ANCHOR_ANGLE),
    y: center.y + radius * Math.sin(-ANCHOR_ANGLE),
  };
  const end = {
    x: center.x + radius * Math.cos(ANCHOR_ANGLE),
    y: center.y + radius * Math.sin(ANCHOR_ANGLE),
  };
  const path = `M ${start.x},${start.y} A ${LOOP_RADIUS},${LOOP_RADIUS} 0 1,1 ${end.x},${end.y}`;
  const labelX = center.x + radius + LOOP_RADIUS * 1.6;
  const labelY = center.y;

  return (
    <>
      <path
        id={id}
        d={path}
        markerEnd={markerEnd as string | undefined}
        style={style}
        fill="none"
        className="react-flow__edge-path"
      />
      <path
        d={path}
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
