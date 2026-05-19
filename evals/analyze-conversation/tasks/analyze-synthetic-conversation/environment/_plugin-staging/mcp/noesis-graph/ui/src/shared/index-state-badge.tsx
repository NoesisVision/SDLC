import { Group, Loader, Text, Tooltip } from "@mantine/core";
import { IconAlertTriangle, IconCircleFilled } from "@tabler/icons-react";
import type { IndexStateData } from "../../../ui-contracts/index-state/index-state-data.js";
import { useIndexState } from "./use-index-state.js";

export function IndexStateBadge() {
  const state = useIndexState();
  return <BadgeContent state={state} />;
}

interface BadgeContentProps {
  state: IndexStateData | null;
}

function BadgeContent({ state }: BadgeContentProps) {
  if (state === null) {
    return (
      <Tooltip label="Index status unavailable">
        <Group gap={6}>
          <IconCircleFilled size={10} color="var(--mantine-color-gray-6)" />
          <Text size="xs" c="dimmed">
            unknown
          </Text>
        </Group>
      </Tooltip>
    );
  }

  switch (state.state) {
    case "consistent":
      return (
        <Tooltip
          label={tooltip("Index consistent", state)}
          multiline
          w={260}
        >
          <Group gap={6}>
            <IconCircleFilled
              size={10}
              color="var(--mantine-color-noesisGreen-6)"
            />
            <Text size="xs" c="dimmed">
              consistent
            </Text>
          </Group>
        </Tooltip>
      );
    case "indexing":
      return (
        <Tooltip
          label={tooltip("Index rebuilding", state)}
          multiline
          w={260}
        >
          <Group gap={6}>
            <Loader size={10} color="red" />
            <Text size="xs" c="dimmed">
              indexing {state.files_processed}/{state.files_total}
            </Text>
          </Group>
        </Tooltip>
      );
    case "error":
      return (
        <Tooltip
          label={tooltip(state.last_error ?? "Index error", state)}
          multiline
          w={260}
        >
          <Group gap={6}>
            <IconAlertTriangle size={12} color="var(--mantine-color-red-6)" />
            <Text size="xs" c="red">
              error
            </Text>
          </Group>
        </Tooltip>
      );
    default:
      return null;
  }
}

function tooltip(headline: string, state: IndexStateData): string {
  const last = state.last_completed_at
    ? `Last sync: ${state.last_completed_at}`
    : "Never synced";
  const stale =
    state.stale_dependents > 0
      ? `Stale dependents: ${state.stale_dependents}`
      : "No stale dependents";
  return `${headline}\n${last}\n${stale}`;
}
