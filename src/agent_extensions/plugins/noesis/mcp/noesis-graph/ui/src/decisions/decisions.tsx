import { useCallback, useEffect, useState } from "react";
import {
  Badge,
  Box,
  Card,
  Group,
  Loader,
  Stack,
  Text,
  ThemeIcon,
  Title,
} from "@mantine/core";
import { IconGavel } from "@tabler/icons-react";
import classes from "./decisions.module.css";
import type {
  DecisionDetailData,
  DecisionListItem,
  DecisionsPageData,
} from "../../../ui-contracts/decisions/decisions-data.js";

export function DecisionsPage() {
  const [data, setData] = useState<DecisionsPageData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/ui/decisions")
      .then((res) => {
        if (!res.ok) throw new Error(`Failed to load decisions (${res.status})`);
        return res.json() as Promise<DecisionsPageData>;
      })
      .then((d) => setData(d))
      .catch((err: Error) => setError(err.message));
  }, []);

  const handleSelect = useCallback((id: string) => {
    setSelectedId(id);
  }, []);

  const hasDecisions = data !== null && data.decisions.length > 0;

  return (
    <Box className={classes.page}>
      <Box className={classes.topBar}>
        <Text component="h1" size="xl" fw={700} c="gray.1">
          Decisions
        </Text>
      </Box>

      {error !== null && (
        <Box p="md">
          <Text size="sm" c="red.4">
            {error}
          </Text>
        </Box>
      )}

      {data === null && error === null ? (
        <Box p="lg">
          <Group gap="xs">
            <Loader size={14} color="noesisBlue" />
            <Text size="sm" c="dimmed">
              Loading decisions
            </Text>
          </Group>
        </Box>
      ) : hasDecisions ? (
        <Box className={classes.workspace}>
          <Box className={classes.listColumn}>
            <Box className={classes.columnHeader}>
              <Text
                size="xs"
                fw={700}
                c="dimmed"
                style={{ letterSpacing: "0.22em", textTransform: "uppercase" }}
              >
                Decisions
              </Text>
            </Box>
            <Box className={classes.scrollArea}>
              <Stack gap={6}>
                {data.decisions.map((d) => (
                  <DecisionListRow
                    key={d.id}
                    decision={d}
                    active={d.id === selectedId}
                    onSelect={() => handleSelect(d.id)}
                  />
                ))}
              </Stack>
            </Box>
          </Box>

          <Box className={classes.detailsColumn}>
            {selectedId === null ? (
              <Box className={classes.detailsEmpty}>
                <Text size="sm" c="dimmed">
                  Select a decision on the left to see details.
                </Text>
              </Box>
            ) : (
              <Box className={classes.detailsShell}>
                <Box className={classes.detailsBody}>
                  <DecisionDetails decisionId={selectedId} />
                </Box>
              </Box>
            )}
          </Box>
        </Box>
      ) : data !== null ? (
        <EmptyState />
      ) : null}
    </Box>
  );
}

function DecisionListRow({
  decision,
  active,
  onSelect,
}: {
  decision: DecisionListItem;
  active: boolean;
  onSelect: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onSelect}
      className={`${classes.listItem} ${active ? classes.listItemActive : ""}`}
    >
      <Stack gap={4}>
        <Group gap={6} justify="space-between" wrap="nowrap">
          <Text size="xs" c="dimmed">
            {decision.date === "" ? "—" : decision.date}
          </Text>
          <StatusBadge status={decision.status} />
        </Group>
        <Text size="sm" fw={600} c="gray.1" lineClamp={2}>
          {decision.title}
        </Text>
      </Stack>
    </button>
  );
}

function StatusBadge({ status }: { status: string }) {
  const color = statusColor(status);
  return (
    <Badge size="xs" variant="light" color={color} radius="xl">
      {status}
    </Badge>
  );
}

function statusColor(status: string): string {
  switch (status) {
    case "accepted":
      return "noesisGreen";
    case "proposed":
      return "yellow";
    default:
      return "gray";
  }
}

function DecisionDetails({ decisionId }: { decisionId: string }) {
  const [data, setData] = useState<DecisionDetailData | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setData(null);
    setError(null);
    fetch(`/api/ui/decisions/${encodeURIComponent(decisionId)}`)
      .then((res) => {
        if (!res.ok) throw new Error(`Failed to load decision (${res.status})`);
        return res.json() as Promise<DecisionDetailData>;
      })
      .then((d) => {
        if (!cancelled) setData(d);
      })
      .catch((err: Error) => {
        if (!cancelled) setError(err.message);
      });
    return () => {
      cancelled = true;
    };
  }, [decisionId]);

  if (error !== null) {
    return (
      <Box p="lg">
        <Text size="sm" c="red.4">
          {error}
        </Text>
      </Box>
    );
  }

  if (data === null) {
    return (
      <Box p="lg">
        <Group gap="xs">
          <Loader size={14} color="noesisBlue" />
          <Text size="sm" c="dimmed">
            Loading decision
          </Text>
        </Group>
      </Box>
    );
  }

  return (
    <Stack gap={0}>
      <Box className={classes.section}>
        <Group gap="sm" align="flex-start">
          <ThemeIcon size="lg" variant="light" color="noesisIndigo" radius="sm">
            <IconGavel size={18} stroke={1.5} />
          </ThemeIcon>
          <Stack gap={6} style={{ flex: 1 }}>
            <Title order={1} size="h3" c="gray.1" fw={700}>
              {data.title}
            </Title>
            <Group gap={8}>
              <StatusBadge status={data.status} />
              <Text size="xs" c="dimmed">
                {data.date === "" ? "no date" : data.date}
              </Text>
              <Text size="xs" c="dimmed">
                ·
              </Text>
              <Text size="xs" c="dark.1">
                Topic: {data.topic_title}
              </Text>
            </Group>
          </Stack>
        </Group>
      </Box>

      <Box className={classes.section}>
        <Title order={2} size="h4" c="gray.1" fw={700} mb="xs">
          Context
        </Title>
        <Text className={classes.sectionBody}>
          {data.context_text === "" ? "—" : data.context_text}
        </Text>
      </Box>

      <Box className={classes.section}>
        <Title order={2} size="h4" c="gray.1" fw={700} mb="xs">
          Decision
        </Title>
        <Text className={classes.sectionBody}>
          {data.decision_text === "" ? "—" : data.decision_text}
        </Text>
        {data.decision_rationale !== "" && (
          <Text className={classes.rationale}>
            Rationale: {data.decision_rationale}
          </Text>
        )}
      </Box>

      <Box className={classes.section}>
        <Title order={2} size="h4" c="gray.1" fw={700} mb="xs">
          Alternatives
        </Title>
        {data.alternatives.length === 0 ? (
          <Text size="sm" c="dimmed">
            None.
          </Text>
        ) : (
          <Stack gap="md">
            {data.alternatives.map((a) => (
              <Box key={a.option_index}>
                <Title order={3} size="h5" c="gray.2" fw={600} mb={4}>
                  Option {a.option_index + 1}
                </Title>
                <Text className={classes.sectionBody}>
                  {a.text === "" ? "—" : a.text}
                </Text>
                {a.rationale !== "" && (
                  <Text className={classes.rationale}>
                    Rationale: {a.rationale}
                  </Text>
                )}
              </Box>
            ))}
          </Stack>
        )}
      </Box>
    </Stack>
  );
}

function EmptyState() {
  return (
    <Card withBorder radius="md" bg="dark.6" p="xl" m="lg">
      <Stack align="center" gap="sm">
        <IconGavel size={40} stroke={1} color="var(--mantine-color-gray-5)" />
        <Text size="sm" c="dimmed">
          No decisions yet. Extract decisions from a topic to populate this list.
        </Text>
      </Stack>
    </Card>
  );
}
