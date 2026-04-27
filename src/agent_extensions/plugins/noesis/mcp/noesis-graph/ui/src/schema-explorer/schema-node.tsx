import { memo, type CSSProperties } from "react";
import { Handle, Position, type NodeProps } from "@xyflow/react";
import classes from "./schema-explorer.module.css";

export interface SchemaNodeData extends Record<string, unknown> {
  tableName: string;
  displayName: string;
  selected: boolean;
  dimmed: boolean;
  animationDelayMs: number;
}

export const SchemaNode = memo(function SchemaNode({ data }: NodeProps) {
  const { displayName, selected, dimmed, animationDelayMs } =
    data as SchemaNodeData;

  const className = [
    classes.node,
    selected ? classes.nodeSelected : "",
    dimmed ? classes.nodeDimmed : "",
  ]
    .filter(Boolean)
    .join(" ");

  const style = {
    animationDelay: `${animationDelayMs}ms`,
  } as CSSProperties;

  return (
    <div className={className} style={style}>
      <Handle type="target" position={Position.Top} isConnectable={false} />
      <Handle type="source" position={Position.Bottom} isConnectable={false} />
      <Handle type="target" position={Position.Left} isConnectable={false} />
      <Handle type="source" position={Position.Right} isConnectable={false} />
      <span className={classes.nodeLabel}>{displayName}</span>
    </div>
  );
});
