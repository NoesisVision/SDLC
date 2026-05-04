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
  UnstyledButton,
} from "@mantine/core";
import {
  IconChevronRight,
  IconFileText,
  IconGavel,
  IconTopologyStar,
} from "@tabler/icons-react";
import classes from "./documents.module.css";
import type { CrossNav } from "../app.js";
import type {
  DocumentDecisionRef,
  DocumentDetailData,
  DocumentListItem,
  DocumentTopicRef,
  DocumentsPageData,
} from "../../../ui-contracts/documents/documents-data.js";

export function DocumentsPage({ crossNav }: { crossNav: CrossNav }) {
  const [data, setData] = useState<DocumentsPageData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/ui/documents")
      .then((res) => {
        if (!res.ok) throw new Error(`Failed to load documents (${res.status})`);
        return res.json() as Promise<DocumentsPageData>;
      })
      .then((d) => setData(d))
      .catch((err: Error) => setError(err.message));
  }, []);

  useEffect(() => {
    if (data === null) return;
    if (crossNav.selectionId === null) return;
    const target = data.documents.find((d) => d.id === crossNav.selectionId);
    if (target === undefined) return;
    setSelectedId(target.id);
  }, [data, crossNav.selectionId]);

  const navigateTopic = useCallback(
    (topicId: string) => crossNav.pushTo("/topics", topicId, selectedId),
    [crossNav, selectedId],
  );
  const navigateDecision = useCallback(
    (decisionId: string) =>
      crossNav.pushTo("/decisions", decisionId, selectedId),
    [crossNav, selectedId],
  );

  const hasDocuments = data !== null && data.documents.length > 0;

  return (
    <Box className={classes.page}>
      <Box className={classes.topBar}>
        <Text component="h1" size="xl" fw={700} c="gray.1">
          Documents
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
              Loading documents
            </Text>
          </Group>
        </Box>
      ) : hasDocuments ? (
        <Box className={classes.workspace}>
          <Box className={classes.listColumn}>
            <Box className={classes.columnHeader}>
              <Text
                size="xs"
                fw={700}
                c="dimmed"
                style={{ letterSpacing: "0.22em", textTransform: "uppercase" }}
              >
                Documents
              </Text>
            </Box>
            <Box className={classes.scrollArea}>
              <Stack gap={6}>
                {data.documents.map((d) => (
                  <DocumentListRow
                    key={d.id}
                    document={d}
                    active={d.id === selectedId}
                    onSelect={() => setSelectedId(d.id)}
                  />
                ))}
              </Stack>
            </Box>
          </Box>

          <Box className={classes.detailsColumn}>
            <DetailsPanel
              documentId={selectedId}
              onSelectTopic={navigateTopic}
              onSelectDecision={navigateDecision}
            />
          </Box>
        </Box>
      ) : data !== null ? (
        <EmptyState />
      ) : null}
    </Box>
  );
}

function DocumentListRow({
  document,
  active,
  onSelect,
}: {
  document: DocumentListItem;
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
        <Text size="xs" c="dimmed">
          {document.date === "" ? "—" : document.date}
        </Text>
        <Text size="sm" fw={600} c="gray.1" lineClamp={2}>
          {document.title}
        </Text>
      </Stack>
    </button>
  );
}

function DetailsPanel({
  documentId,
  onSelectTopic,
  onSelectDecision,
}: {
  documentId: string | null;
  onSelectTopic: (topicId: string) => void;
  onSelectDecision: (decisionId: string) => void;
}) {
  if (documentId === null) {
    return (
      <Box className={classes.detailsEmpty}>
        <Text size="sm" c="dimmed">
          Select a document on the left to see details.
        </Text>
      </Box>
    );
  }

  return (
    <Box className={classes.detailsShell}>
      <Box className={classes.detailsBody}>
        <DocumentDetails
          documentId={documentId}
          onSelectTopic={onSelectTopic}
          onSelectDecision={onSelectDecision}
        />
      </Box>
    </Box>
  );
}

function DocumentDetails({
  documentId,
  onSelectTopic,
  onSelectDecision,
}: {
  documentId: string;
  onSelectTopic: (topicId: string) => void;
  onSelectDecision: (decisionId: string) => void;
}) {
  const [data, setData] = useState<DocumentDetailData | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setData(null);
    setError(null);
    fetch(`/api/ui/documents/${encodeURIComponent(documentId)}`)
      .then((res) => {
        if (!res.ok) throw new Error(`Failed to load document (${res.status})`);
        return res.json() as Promise<DocumentDetailData>;
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
  }, [documentId]);

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
            Loading document
          </Text>
        </Group>
      </Box>
    );
  }

  return (
    <Stack gap={0}>
      <Box className={classes.section}>
        <Group gap="sm" align="flex-start" wrap="nowrap">
          <ThemeIcon size="lg" variant="light" color="noesisGreen" radius="sm">
            <IconFileText size={18} stroke={1.5} />
          </ThemeIcon>
          <Stack gap={6} style={{ flex: 1, minWidth: 0 }}>
            <Title order={1} size="h3" c="gray.1" fw={700}>
              {data.title}
            </Title>
            <Group gap={8}>
              <Badge size="xs" variant="light" color="noesisGreen" radius="xl">
                Document
              </Badge>
              <Text size="xs" c="dimmed">
                {data.date === "" ? "no date" : data.date}
              </Text>
            </Group>
          </Stack>
        </Group>
      </Box>

      <Box className={classes.section}>
        <SectionLabel>Topics</SectionLabel>
        {data.topics.length === 0 ? (
          <Text size="sm" c="dimmed" mt="xs">
            No topics linked to this document.
          </Text>
        ) : (
          <Stack gap={4} mt="xs">
            {data.topics.map((t) => (
              <TopicRow
                key={t.topic_id}
                topic={t}
                onSelect={() => onSelectTopic(t.topic_id)}
              />
            ))}
          </Stack>
        )}
      </Box>

      <Box className={classes.section}>
        <SectionLabel>Decisions</SectionLabel>
        {data.decisions.length === 0 ? (
          <Text size="sm" c="dimmed" mt="xs">
            No decisions linked to this document.
          </Text>
        ) : (
          <Stack gap={4} mt="xs">
            {data.decisions.map((d) => (
              <DecisionRow
                key={d.decision_id}
                decision={d}
                onSelect={() => onSelectDecision(d.decision_id)}
              />
            ))}
          </Stack>
        )}
      </Box>
    </Stack>
  );
}

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <Text
      size="xs"
      fw={700}
      c="dimmed"
      style={{ letterSpacing: "0.18em", textTransform: "uppercase" }}
    >
      {children}
    </Text>
  );
}

function TopicRow({
  topic,
  onSelect,
}: {
  topic: DocumentTopicRef;
  onSelect: () => void;
}) {
  return (
    <UnstyledButton
      onClick={onSelect}
      py={8}
      px="sm"
      w="100%"
      className={classes.refRow}
    >
      <Group gap="xs" justify="space-between" wrap="nowrap">
        <Group gap="xs" wrap="nowrap" style={{ minWidth: 0 }}>
          <ThemeIcon size="sm" variant="light" color="noesisIndigo" radius="sm">
            <IconTopologyStar size={14} stroke={1.5} />
          </ThemeIcon>
          <Text size="sm" c="gray.2" lineClamp={1}>
            {topic.title}
          </Text>
        </Group>
        <IconChevronRight
          size={14}
          stroke={1.5}
          color="var(--mantine-color-dark-2)"
        />
      </Group>
    </UnstyledButton>
  );
}

function DecisionRow({
  decision,
  onSelect,
}: {
  decision: DocumentDecisionRef;
  onSelect: () => void;
}) {
  return (
    <UnstyledButton
      onClick={onSelect}
      py={8}
      px="sm"
      w="100%"
      className={classes.refRow}
    >
      <Group gap="xs" justify="space-between" wrap="nowrap">
        <Group gap="xs" wrap="nowrap" style={{ minWidth: 0 }}>
          <ThemeIcon size="sm" variant="light" color="noesisIndigo" radius="sm">
            <IconGavel size={14} stroke={1.5} />
          </ThemeIcon>
          <Text size="sm" c="gray.2" lineClamp={1}>
            {decision.title}
          </Text>
          <Badge
            size="xs"
            variant="light"
            color={decisionStatusColor(decision.status)}
            radius="xl"
          >
            {decision.status}
          </Badge>
        </Group>
        <IconChevronRight
          size={14}
          stroke={1.5}
          color="var(--mantine-color-dark-2)"
        />
      </Group>
    </UnstyledButton>
  );
}

function decisionStatusColor(status: string): string {
  switch (status) {
    case "accepted":
      return "noesisGreen";
    case "proposed":
      return "yellow";
    default:
      return "gray";
  }
}

function EmptyState() {
  return (
    <Card withBorder radius="md" bg="dark.6" p="xl" m="lg">
      <Stack align="center" gap="sm">
        <IconFileText size={40} stroke={1} color="var(--mantine-color-gray-5)" />
        <Text size="sm" c="dimmed">
          No documents yet. Add one from a skill to populate the knowledge
          graph.
        </Text>
      </Stack>
    </Card>
  );
}
