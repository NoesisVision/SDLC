import { memo } from "react";
import { Handle, Position, type NodeProps } from "@xyflow/react";
import { Badge, Box, Group, Stack, Text } from "@mantine/core";
import { IconKey } from "@tabler/icons-react";

interface PropertySchema {
  name: string;
  type: string;
  isPrimaryKey: boolean;
}

interface SchemaTableData {
  tableName: string;
  properties: PropertySchema[];
  colors: { bg: string; border: string; header: string };
  highlighted: boolean;
  dimmed: boolean;
}

export const SchemaTableNode = memo(function SchemaTableNode({
  data,
}: NodeProps) {
  const { tableName, properties, colors, dimmed } = data as unknown as SchemaTableData;

  return (
    <Box
      style={{
        minWidth: 240,
        borderRadius: 8,
        border: `1.5px solid ${colors.border}`,
        backgroundColor: colors.bg,
        overflow: "hidden",
        opacity: dimmed ? 0.3 : 1,
        transition: "opacity 150ms ease-in-out, box-shadow 150ms ease-in-out",
        boxShadow: dimmed
          ? "none"
          : `0 0 12px ${colors.border}33`,
      }}
    >
      <Handle type="target" position={Position.Top} style={handleStyle} />
      <Handle type="source" position={Position.Bottom} style={handleStyle} />
      <Handle type="target" position={Position.Left} style={handleStyle} />
      <Handle type="source" position={Position.Right} style={handleStyle} />

      <Box
        px="sm"
        py={8}
        style={{
          backgroundColor: colors.header,
          borderBottom: `1px solid ${colors.border}`,
        }}
      >
        <Text size="sm" fw={700} c="white" style={{ letterSpacing: 0.3 }}>
          {tableName}
        </Text>
      </Box>

      <Stack gap={0} px="sm" py={6}>
        {properties.map((prop) => (
          <Group
            key={prop.name}
            gap={6}
            py={3}
            wrap="nowrap"
            style={{
              borderBottom: "1px solid rgba(255,255,255,0.05)",
            }}
          >
            {prop.isPrimaryKey && (
              <IconKey size={12} color="#eab308" stroke={2} />
            )}
            <Text size="xs" c="gray.2" fw={prop.isPrimaryKey ? 600 : 400} style={{ flex: 1 }}>
              {prop.name}
            </Text>
            <Badge
              size="xs"
              variant="light"
              color="gray"
              radius="sm"
              styles={{ root: { textTransform: "uppercase", fontSize: 9 } }}
            >
              {prop.type}
            </Badge>
          </Group>
        ))}
      </Stack>
    </Box>
  );
});

const handleStyle = {
  width: 6,
  height: 6,
  backgroundColor: "#6b7280",
  border: "1px solid #374151",
};
