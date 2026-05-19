import { Badge, Group, Tooltip } from "@mantine/core";

interface Props {
  is_stale?: boolean;
  edited_by_user?: boolean;
}

export function SyncBadges({ is_stale, edited_by_user }: Props) {
  if (!is_stale && !edited_by_user) return null;
  return (
    <Group gap={4}>
      {edited_by_user && (
        <Tooltip
          label="This file has been manually edited; the next skill run will skip it."
          withArrow
        >
          <Badge size="xs" variant="light" color="yellow" radius="xl">
            user-edited
          </Badge>
        </Tooltip>
      )}
      {is_stale && (
        <Tooltip
          label="A referenced source file changed since this entity's items were attached. Re-run the relevant skill to refresh."
          withArrow
        >
          <Badge size="xs" variant="light" color="red" radius="xl">
            stale
          </Badge>
        </Tooltip>
      )}
    </Group>
  );
}
