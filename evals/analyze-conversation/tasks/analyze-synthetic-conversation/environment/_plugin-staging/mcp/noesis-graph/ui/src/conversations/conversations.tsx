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
  IconGavel,
  IconMessageCircle,
  IconMessages,
  IconTopologyStar,
} from "@tabler/icons-react";
import classes from "./conversations.module.css";
import type { CrossNav } from "../app.js";
import type {
  ConversationDecisionRef,
  ConversationDetailData,
  ConversationListItem,
  ConversationTopicRef,
  ConversationsPageData,
} from "../../../ui-contracts/conversations/conversations-data.js";

export function ConversationsPage({ crossNav }: { crossNav: CrossNav }) {
  const [data, setData] = useState<ConversationsPageData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/ui/conversations")
      .then((res) => {
        if (!res.ok)
          throw new Error(`Failed to load conversations (${res.status})`);
        return res.json() as Promise<ConversationsPageData>;
      })
      .then((d) => setData(d))
      .catch((err: Error) => setError(err.message));
  }, []);

  useEffect(() => {
    if (data === null) return;
    if (crossNav.selectionId === null) return;
    const target = data.conversations.find(
      (c) => c.id === crossNav.selectionId,
    );
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

  const hasConversations = data !== null && data.conversations.length > 0;

  return (
    <Box className={classes.page}>
      <Box className={classes.topBar}>
        <Text component="h1" size="xl" fw={700} c="gray.1">
          Conversations
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
              Loading conversations
            </Text>
          </Group>
        </Box>
      ) : hasConversations ? (
        <Box className={classes.workspace}>
          <Box className={classes.listColumn}>
            <Box className={classes.columnHeader}>
              <Text
                size="xs"
                fw={700}
                c="dimmed"
                style={{ letterSpacing: "0.22em", textTransform: "uppercase" }}
              >
                Conversations
              </Text>
            </Box>
            <Box className={classes.scrollArea}>
              <Stack gap={6}>
                {data.conversations.map((c) => (
                  <ConversationListRow
                    key={c.id}
                    conversation={c}
                    active={c.id === selectedId}
                    onSelect={() => setSelectedId(c.id)}
                  />
                ))}
              </Stack>
            </Box>
          </Box>

          <Box className={classes.detailsColumn}>
            <DetailsPanel
              conversationId={selectedId}
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

function ConversationListRow({
  conversation,
  active,
  onSelect,
}: {
  conversation: ConversationListItem;
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
          {conversation.date === "" ? "—" : conversation.date}
        </Text>
        <Text size="sm" fw={600} c="gray.1" lineClamp={2}>
          {conversation.title}
        </Text>
      </Stack>
    </button>
  );
}

function DetailsPanel({
  conversationId,
  onSelectTopic,
  onSelectDecision,
}: {
  conversationId: string | null;
  onSelectTopic: (topicId: string) => void;
  onSelectDecision: (decisionId: string) => void;
}) {
  if (conversationId === null) {
    return (
      <Box className={classes.detailsEmpty}>
        <Text size="sm" c="dimmed">
          Select a conversation on the left to see details.
        </Text>
      </Box>
    );
  }

  return (
    <Box className={classes.detailsShell}>
      <Box className={classes.detailsBody}>
        <ConversationDetails
          conversationId={conversationId}
          onSelectTopic={onSelectTopic}
          onSelectDecision={onSelectDecision}
        />
      </Box>
    </Box>
  );
}

function ConversationDetails({
  conversationId,
  onSelectTopic,
  onSelectDecision,
}: {
  conversationId: string;
  onSelectTopic: (topicId: string) => void;
  onSelectDecision: (decisionId: string) => void;
}) {
  const [data, setData] = useState<ConversationDetailData | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setData(null);
    setError(null);
    fetch(`/api/ui/conversations/${encodeURIComponent(conversationId)}`)
      .then((res) => {
        if (!res.ok)
          throw new Error(`Failed to load conversation (${res.status})`);
        return res.json() as Promise<ConversationDetailData>;
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
  }, [conversationId]);

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
            Loading conversation
          </Text>
        </Group>
      </Box>
    );
  }

  return (
    <Stack gap={0}>
      <Box className={classes.section}>
        <Group gap="sm" align="flex-start" wrap="nowrap">
          <ThemeIcon size="lg" variant="light" color="noesisBlue" radius="sm">
            <IconMessageCircle size={18} stroke={1.5} />
          </ThemeIcon>
          <Stack gap={6} style={{ flex: 1, minWidth: 0 }}>
            <Title order={1} size="h3" c="gray.1" fw={700}>
              {data.title}
            </Title>
            <Group gap={8}>
              <Badge size="xs" variant="light" color="noesisBlue" radius="xl">
                Conversation
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
            No topics linked to this conversation.
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
            No decisions linked to this conversation.
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
  topic: ConversationTopicRef;
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
  decision: ConversationDecisionRef;
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
        <IconMessages size={40} stroke={1} color="var(--mantine-color-gray-5)" />
        <Text size="sm" c="dimmed">
          No conversations yet. Add one from a skill to populate the knowledge
          graph.
        </Text>
      </Stack>
    </Card>
  );
}
