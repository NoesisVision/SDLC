import { useCallback, useEffect, useState } from "react";
import {
  ActionIcon,
  Badge,
  Box,
  Card,
  Collapse,
  Group,
  Loader,
  Stack,
  Text,
  ThemeIcon,
  UnstyledButton,
} from "@mantine/core";
import {
  IconArrowLeft,
  IconChevronDown,
  IconChevronRight,
  IconFileText,
  IconMessageCircle,
  IconTopologyStar,
} from "@tabler/icons-react";
import { MarkdownContent } from "../shared/markdown-content.js";
import { InlineEdit } from "../shared/inline-edit.js";
import { SyncBadges } from "../shared/sync-badges.js";
import {
  categoryColor,
  groupIdeaUnitsByTurn,
} from "../shared/idea-units.js";
import classes from "./topics.module.css";
import type { CrossNav } from "../app.js";
import type {
  TopicConversationDetail,
  TopicConversationRef,
  TopicDocumentDetail,
  TopicDocumentRef,
  TopicNode,
  TopicsPageData,
} from "../../../ui-contracts/topics/topics-data.js";

type View =
  | { kind: "topic"; topic: TopicNode }
  | {
      kind: "conversation";
      topic: TopicNode;
      conversation: TopicConversationRef;
    }
  | { kind: "document"; topic: TopicNode; document: TopicDocumentRef };

interface NavState {
  current: View | null;
  stack: View[];
}

type TopicEditableFields = Partial<{
  title: string;
  short_summary: string;
  long_summary: string;
}>;

async function patchTopic(
  topicId: string,
  fields: TopicEditableFields,
): Promise<void> {
  const res = await fetch(`/api/ui/topics/${encodeURIComponent(topicId)}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(fields),
  });
  if (!res.ok) {
    throw new Error(`Failed to save (${res.status})`);
  }
}

function applyTopicUpdate(
  topics: TopicNode[],
  topicId: string,
  fields: TopicEditableFields,
): TopicNode[] {
  return topics.map((t) => {
    if (t.id === topicId) {
      return { ...t, ...fields };
    }
    if (t.subtopics.length > 0) {
      return { ...t, subtopics: applyTopicUpdate(t.subtopics, topicId, fields) };
    }
    return t;
  });
}

export function TopicsPage({ crossNav }: { crossNav: CrossNav }) {
  const [data, setData] = useState<TopicsPageData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [nav, setNav] = useState<NavState>({ current: null, stack: [] });

  useEffect(() => {
    fetch("/api/ui/topics")
      .then((res) => {
        if (!res.ok) throw new Error(`Failed to load topics (${res.status})`);
        return res.json() as Promise<TopicsPageData>;
      })
      .then((d) => setData(d))
      .catch((err: Error) => setError(err.message));
  }, []);

  useEffect(() => {
    if (data === null) return;
    if (crossNav.initialSelectionId === null) return;
    const target = findTopicById(data.topics, crossNav.initialSelectionId);
    if (target === null) return;
    setNav({ current: { kind: "topic", topic: target }, stack: [] });
  }, [data, crossNav.initialSelectionId]);

  const updateTopic = useCallback(
    async (topicId: string, fields: TopicEditableFields): Promise<void> => {
      await patchTopic(topicId, fields);
      setData((prev) =>
        prev === null ? prev : { topics: applyTopicUpdate(prev.topics, topicId, fields) },
      );
      setNav((prev) => {
        if (prev.current === null) return prev;
        const updateView = (view: View): View => {
          if (view.topic.id !== topicId) return view;
          return { ...view, topic: { ...view.topic, ...fields } };
        };
        return {
          current: updateView(prev.current),
          stack: prev.stack.map(updateView),
        };
      });
    },
    [],
  );

  const pushView = useCallback((view: View) => {
    setNav((prev) => {
      if (prev.current === null) return { current: view, stack: [] };
      if (isSameView(prev.current, view)) return prev;
      return { current: view, stack: [...prev.stack, prev.current] };
    });
  }, []);

  const goBack = useCallback(() => {
    setNav((prev) => {
      if (prev.stack.length === 0) return prev;
      const next = prev.stack[prev.stack.length - 1];
      return { current: next, stack: prev.stack.slice(0, -1) };
    });
  }, []);

  const selectTopic = useCallback(
    (topic: TopicNode) =>
      setNav({ current: { kind: "topic", topic }, stack: [] }),
    [],
  );

  const hasTopics = data !== null && data.topics.length > 0;

  return (
    <Box className={classes.page}>
      <Box className={classes.topBar}>
        <Text component="h1" size="xl" fw={700} c="gray.1">
          Topics
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
              Loading topics
            </Text>
          </Group>
        </Box>
      ) : hasTopics ? (
        <Box className={classes.workspace}>
          <Box className={classes.treeColumn}>
            <Box className={classes.columnHeader}>
              <Text
                size="xs"
                fw={700}
                c="dimmed"
                style={{ letterSpacing: "0.22em", textTransform: "uppercase" }}
              >
                Topics
              </Text>
            </Box>
            <Box className={classes.scrollArea}>
              <TopicsTree
                topics={data.topics}
                current={nav.current}
                onSelect={selectTopic}
              />
            </Box>
          </Box>

          <Box className={classes.detailsColumn}>
            <DetailsPanel
              current={nav.current}
              canGoBack={nav.stack.length > 0}
              onBack={goBack}
              onSelectConversation={(topic, conversation) =>
                pushView({ kind: "conversation", topic, conversation })
              }
              onSelectDocument={(topic, document) =>
                pushView({ kind: "document", topic, document })
              }
              onUpdateTopic={updateTopic}
            />
          </Box>
        </Box>
      ) : data !== null ? (
        <EmptyState />
      ) : null}
    </Box>
  );
}

function findTopicById(topics: TopicNode[], id: string): TopicNode | null {
  for (const t of topics) {
    if (t.id === id) return t;
    const sub = findTopicById(t.subtopics, id);
    if (sub !== null) return sub;
  }
  return null;
}

function isSameView(a: View, b: View): boolean {
  if (a.kind !== b.kind) return false;
  if (a.kind === "topic" && b.kind === "topic") return a.topic.id === b.topic.id;
  if (a.kind === "conversation" && b.kind === "conversation")
    return (
      a.topic.id === b.topic.id &&
      a.conversation.conversation_id === b.conversation.conversation_id
    );
  if (a.kind === "document" && b.kind === "document")
    return (
      a.topic.id === b.topic.id &&
      a.document.document_id === b.document.document_id
    );
  return false;
}

function TopicsTree({
  topics,
  current,
  onSelect,
}: {
  topics: TopicNode[];
  current: View | null;
  onSelect: (topic: TopicNode) => void;
}) {
  return (
    <Stack gap="sm">
      {topics.map((topic) => (
        <TopicTreeRoot
          key={topic.id}
          topic={topic}
          current={current}
          onSelect={onSelect}
        />
      ))}
    </Stack>
  );
}

function TopicTreeRoot({
  topic,
  current,
  onSelect,
}: {
  topic: TopicNode;
  current: View | null;
  onSelect: (topic: TopicNode) => void;
}) {
  const [opened, setOpened] = useState(true);
  const hasChildren = topic.subtopics.length > 0;
  const active = isTopicActive(current, topic.id);

  return (
    <Card withBorder radius="md" bg="dark.6" p={0}>
      <TreeNodeButton
        onToggle={() => setOpened((v) => !v)}
        onSelect={() => onSelect(topic)}
        opened={opened}
        hasChildren={hasChildren}
        active={active}
        icon={
          <ThemeIcon size="sm" variant="light" color="noesisIndigo" radius="sm">
            <IconTopologyStar size={14} stroke={1.5} />
          </ThemeIcon>
        }
        label={topic.title}
        badge={
          <Group gap={4}>
            <Badge size="xs" variant="light" color="noesisIndigo" radius="xl">
              Topic
            </Badge>
            <SyncBadges
              is_stale={topic.is_stale}
              edited_by_user={topic.edited_by_user}
            />
          </Group>
        }
        level={0}
      />
      {hasChildren && (
        <Collapse in={opened}>
          <Box pl="md" pb="xs">
            {topic.subtopics.map((sub) => (
              <TopicTreeBranch
                key={sub.id}
                topic={sub}
                level={1}
                current={current}
                onSelect={onSelect}
              />
            ))}
          </Box>
        </Collapse>
      )}
    </Card>
  );
}

function TopicTreeBranch({
  topic,
  level,
  current,
  onSelect,
}: {
  topic: TopicNode;
  level: number;
  current: View | null;
  onSelect: (topic: TopicNode) => void;
}) {
  const [opened, setOpened] = useState(false);
  const hasChildren = topic.subtopics.length > 0;
  const active = isTopicActive(current, topic.id);

  return (
    <Box>
      <TreeNodeButton
        onToggle={() => setOpened((v) => !v)}
        onSelect={() => onSelect(topic)}
        opened={opened}
        hasChildren={hasChildren}
        active={active}
        icon={
          <ThemeIcon size="sm" variant="light" color="noesisIndigo" radius="sm">
            <IconTopologyStar size={14} stroke={1.5} />
          </ThemeIcon>
        }
        label={topic.title}
        badge={
          <SyncBadges
            is_stale={topic.is_stale}
            edited_by_user={topic.edited_by_user}
          />
        }
        level={level}
      />
      {hasChildren && (
        <Collapse in={opened}>
          <Box pl="md">
            {topic.subtopics.map((sub) => (
              <TopicTreeBranch
                key={sub.id}
                topic={sub}
                level={level + 1}
                current={current}
                onSelect={onSelect}
              />
            ))}
          </Box>
        </Collapse>
      )}
    </Box>
  );
}

function isTopicActive(current: View | null, topicId: string): boolean {
  if (current === null) return false;
  return current.topic.id === topicId;
}

function TreeNodeButton({
  onToggle,
  onSelect,
  opened,
  hasChildren,
  active,
  icon,
  label,
  badge,
  level,
}: {
  onToggle: () => void;
  onSelect: () => void;
  opened: boolean;
  hasChildren: boolean;
  active: boolean;
  icon: React.ReactNode;
  label: string;
  badge: React.ReactNode;
  level: number;
}) {
  return (
    <UnstyledButton
      onClick={onSelect}
      w="100%"
      py={6}
      px="xs"
      pl={level * 8 + 8}
      style={(theme) => ({
        borderRadius: theme.radius.sm,
        backgroundColor: active ? "rgba(79, 141, 226, 0.12)" : "transparent",
        transition: "background-color 150ms ease",
      })}
    >
      <Group gap={6} wrap="nowrap">
        {hasChildren ? (
          <ActionIcon
            variant="subtle"
            color="gray"
            size="xs"
            component="div"
            onClick={(event) => {
              event.stopPropagation();
              onToggle();
            }}
          >
            {opened ? (
              <IconChevronDown size={14} stroke={1.5} />
            ) : (
              <IconChevronRight size={14} stroke={1.5} />
            )}
          </ActionIcon>
        ) : (
          <Box w={16} />
        )}
        {icon}
        <Text size="sm" fw={600} c="gray.1" lineClamp={1} style={{ flex: 1 }}>
          {label}
        </Text>
        {badge}
      </Group>
    </UnstyledButton>
  );
}

function DetailsPanel({
  current,
  canGoBack,
  onBack,
  onSelectConversation,
  onSelectDocument,
  onUpdateTopic,
}: {
  current: View | null;
  canGoBack: boolean;
  onBack: () => void;
  onSelectConversation: (
    topic: TopicNode,
    conversation: TopicConversationRef,
  ) => void;
  onSelectDocument: (topic: TopicNode, document: TopicDocumentRef) => void;
  onUpdateTopic: (topicId: string, fields: TopicEditableFields) => Promise<void>;
}) {
  if (current === null) {
    return (
      <Box className={classes.detailsEmpty}>
        <Text size="sm" c="dimmed">
          Select a topic on the left to see details.
        </Text>
      </Box>
    );
  }

  return (
    <Box className={classes.detailsShell}>
      {canGoBack && (
        <Box className={classes.detailsHeader}>
          <BackButton onBack={onBack} />
        </Box>
      )}
      <Box className={classes.detailsBody}>
        {current.kind === "topic" && (
          <TopicDetails
            topic={current.topic}
            onSelectConversation={(c) =>
              onSelectConversation(current.topic, c)
            }
            onSelectDocument={(d) => onSelectDocument(current.topic, d)}
            onUpdateTopic={onUpdateTopic}
          />
        )}
        {current.kind === "conversation" && (
          <ConversationDetails
            topicId={current.topic.id}
            conversationId={current.conversation.conversation_id}
            fallbackTitle={current.conversation.title}
          />
        )}
        {current.kind === "document" && (
          <DocumentDetails
            topicId={current.topic.id}
            documentId={current.document.document_id}
            fallbackTitle={current.document.title}
          />
        )}
      </Box>
    </Box>
  );
}

function BackButton({ onBack }: { onBack: () => void }) {
  return (
    <UnstyledButton onClick={onBack} className={classes.backButton}>
      <IconArrowLeft size={14} stroke={1.75} />
      <span>Back</span>
    </UnstyledButton>
  );
}

function TopicDetails({
  topic,
  onSelectConversation,
  onSelectDocument,
  onUpdateTopic,
}: {
  topic: TopicNode;
  onSelectConversation: (conversation: TopicConversationRef) => void;
  onSelectDocument: (document: TopicDocumentRef) => void;
  onUpdateTopic: (topicId: string, fields: TopicEditableFields) => Promise<void>;
}) {
  return (
    <Box p="lg">
      <Stack gap="lg">
        <Group gap="sm" align="center" wrap="nowrap">
          <ThemeIcon size="lg" variant="light" color="noesisIndigo" radius="sm">
            <IconTopologyStar size={18} stroke={1.5} />
          </ThemeIcon>
          <Stack gap={2} style={{ flex: 1, minWidth: 0 }}>
            <InlineEdit
              value={topic.title}
              mode="text"
              ariaLabel="Edit title"
              onSave={(next) => onUpdateTopic(topic.id, { title: next })}
              display={
                <Text size="xl" fw={700} c="gray.1">
                  {topic.title}
                </Text>
              }
            />
            <Text size="xs" c="dimmed">
              Topic
            </Text>
          </Stack>
        </Group>

        <Stack gap={4}>
          <SectionLabel>Summary</SectionLabel>
          <InlineEdit
            value={topic.short_summary}
            mode="textarea"
            block
            ariaLabel="Edit short summary"
            onSave={(next) => onUpdateTopic(topic.id, { short_summary: next })}
            display={
              topic.short_summary === "" ? (
                <Text size="sm" c="dimmed">
                  No summary.
                </Text>
              ) : (
                <MarkdownContent text={topic.short_summary} />
              )
            }
          />
        </Stack>

        <Stack gap={4}>
          <SectionLabel>Details</SectionLabel>
          <InlineEdit
            value={topic.long_summary}
            mode="textarea"
            block
            ariaLabel="Edit long summary"
            onSave={(next) => onUpdateTopic(topic.id, { long_summary: next })}
            display={
              topic.long_summary === "" ? (
                <Text size="sm" c="dimmed">
                  No details.
                </Text>
              ) : (
                <MarkdownContent text={topic.long_summary} />
              )
            }
          />
        </Stack>

        <Stack gap="xs">
          <SectionLabel>Conversations</SectionLabel>
          {topic.conversations.length === 0 ? (
            <Text size="sm" c="dimmed">
              No conversations linked to this topic.
            </Text>
          ) : (
            <Stack gap={4}>
              {topic.conversations.map((c) => (
                <ConversationRow
                  key={c.conversation_id}
                  conversation={c}
                  onSelect={() => onSelectConversation(c)}
                />
              ))}
            </Stack>
          )}
        </Stack>

        <Stack gap="xs">
          <SectionLabel>Documents</SectionLabel>
          {topic.documents.length === 0 ? (
            <Text size="sm" c="dimmed">
              No documents linked to this topic.
            </Text>
          ) : (
            <Stack gap={4}>
              {topic.documents.map((d) => (
                <DocumentRow
                  key={d.document_id}
                  document={d}
                  onSelect={() => onSelectDocument(d)}
                />
              ))}
            </Stack>
          )}
        </Stack>
      </Stack>
    </Box>
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

function ConversationRow({
  conversation,
  onSelect,
}: {
  conversation: TopicConversationRef;
  onSelect: () => void;
}) {
  return (
    <UnstyledButton onClick={onSelect} py={8} px="sm" w="100%" className={classes.refRow}>
      <Group gap="xs" justify="space-between" wrap="nowrap">
        <Group gap="xs" wrap="nowrap" style={{ minWidth: 0 }}>
          <ThemeIcon size="sm" variant="light" color="noesisBlue" radius="sm">
            <IconMessageCircle size={14} stroke={1.5} />
          </ThemeIcon>
          <Stack gap={0} style={{ minWidth: 0 }}>
            <Text size="sm" c="gray.2" lineClamp={1}>
              {conversation.title}
            </Text>
            <Text size="xs" c="dimmed">
              {conversation.date}
            </Text>
          </Stack>
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

function DocumentRow({
  document,
  onSelect,
}: {
  document: TopicDocumentRef;
  onSelect: () => void;
}) {
  return (
    <UnstyledButton onClick={onSelect} py={8} px="sm" w="100%" className={classes.refRow}>
      <Group gap="xs" justify="space-between" wrap="nowrap">
        <Group gap="xs" wrap="nowrap" style={{ minWidth: 0 }}>
          <ThemeIcon size="sm" variant="light" color="noesisGreen" radius="sm">
            <IconFileText size={14} stroke={1.5} />
          </ThemeIcon>
          <Stack gap={0} style={{ minWidth: 0 }}>
            <Text size="sm" c="gray.2" lineClamp={1}>
              {document.title}
            </Text>
            <Text size="xs" c="dimmed">
              {document.date}
            </Text>
          </Stack>
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

function ConversationDetails({
  topicId,
  conversationId,
  fallbackTitle,
}: {
  topicId: string;
  conversationId: string;
  fallbackTitle: string;
}) {
  const [data, setData] = useState<TopicConversationDetail | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setData(null);
    setError(null);
    fetch(
      `/api/ui/topics/${encodeURIComponent(topicId)}/conversations/${encodeURIComponent(conversationId)}`,
    )
      .then((res) => {
        if (!res.ok) throw new Error(`Failed to load conversation (${res.status})`);
        return res.json() as Promise<TopicConversationDetail>;
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
  }, [topicId, conversationId]);

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
            Loading {fallbackTitle}
          </Text>
        </Group>
      </Box>
    );
  }

  const turnGroups = groupIdeaUnitsByTurn(data.idea_units);

  return (
    <Box p="lg">
      <Stack gap="lg">
        <Group gap="sm" align="center">
          <ThemeIcon size="lg" variant="light" color="noesisBlue" radius="sm">
            <IconMessageCircle size={18} stroke={1.5} />
          </ThemeIcon>
          <Stack gap={2}>
            <Text size="xl" fw={700} c="gray.1">
              {data.conversation_title}
            </Text>
            <Group gap={6}>
              <Badge size="xs" variant="light" color="noesisBlue" radius="xl">
                Conversation
              </Badge>
              <Text size="xs" c="dimmed">
                {data.conversation_date}
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

        {turnGroups.length === 0 ? (
          <Text size="sm" c="dimmed">
            No idea units linked to this topic from this conversation.
          </Text>
        ) : (
          <Stack gap="sm">
            {turnGroups.map((turn) => (
              <Box key={turn.turn_index} className={classes.turnGroup}>
                <Box className={classes.turnHeader}>
                  <Badge size="xs" variant="light" color="noesisIndigo" radius="xl">
                    T{turn.turn_index}
                  </Badge>
                  <Text size="sm" fw={600} c="gray.1">
                    {turn.speaker}
                  </Text>
                  <Text size="xs" c="dimmed">
                    {turn.time}
                  </Text>
                </Box>
                <Stack gap={0}>
                  {turn.idea_units.map((iu) => (
                    <Box
                      key={iu.idea_unit_index}
                      className={classes.ideaUnit}
                    >
                      <Group gap={6} mb={4}>
                        {iu.categories.map((cat) => (
                          <Badge
                            key={cat}
                            size="xs"
                            variant="light"
                            color={categoryColor(cat)}
                            radius="xl"
                          >
                            {cat}
                          </Badge>
                        ))}
                      </Group>
                      <Text size="sm" c="gray.2">
                        {iu.sentences.join(" ")}
                      </Text>
                    </Box>
                  ))}
                </Stack>
              </Box>
            ))}
          </Stack>
        )}
      </Stack>
    </Box>
  );
}

function DocumentDetails({
  topicId,
  documentId,
  fallbackTitle,
}: {
  topicId: string;
  documentId: string;
  fallbackTitle: string;
}) {
  const [data, setData] = useState<TopicDocumentDetail | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setData(null);
    setError(null);
    fetch(
      `/api/ui/topics/${encodeURIComponent(topicId)}/documents/${encodeURIComponent(documentId)}`,
    )
      .then((res) => {
        if (!res.ok) throw new Error(`Failed to load document (${res.status})`);
        return res.json() as Promise<TopicDocumentDetail>;
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
  }, [topicId, documentId]);

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
            Loading {fallbackTitle}
          </Text>
        </Group>
      </Box>
    );
  }

  return (
    <Box p="lg">
      <Stack gap="lg">
        <Group gap="sm" align="center">
          <ThemeIcon size="lg" variant="light" color="noesisGreen" radius="sm">
            <IconFileText size={18} stroke={1.5} />
          </ThemeIcon>
          <Stack gap={2}>
            <Text size="xl" fw={700} c="gray.1">
              {data.document_title}
            </Text>
            <Group gap={6}>
              <Badge size="xs" variant="light" color="noesisGreen" radius="xl">
                Document
              </Badge>
              <Text size="xs" c="dimmed">
                {data.document_date}
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

        {data.fragments.length === 0 ? (
          <Text size="sm" c="dimmed">
            No document fragments linked to this topic from this document.
          </Text>
        ) : (
          <Stack gap="sm">
            {data.fragments.map((f) => (
              <Box
                key={`${f.start_offset}:${f.end_offset}`}
                className={classes.fragmentCard}
              >
                <Group gap={6} mb={6}>
                  <Badge size="xs" variant="light" color="dark.2" radius="xl">
                    {f.start_offset}–{f.end_offset}
                  </Badge>
                </Group>
                <MarkdownContent text={f.text} variant="sm" />
              </Box>
            ))}
          </Stack>
        )}
      </Stack>
    </Box>
  );
}

function EmptyState() {
  return (
    <Card withBorder radius="md" bg="dark.6" p="xl" m="lg">
      <Stack align="center" gap="sm">
        <IconTopologyStar size={40} stroke={1} color="var(--mantine-color-gray-5)" />
        <Text size="sm" c="dimmed">
          No topics yet. Add a conversation or design draft to populate the knowledge graph.
        </Text>
      </Stack>
    </Card>
  );
}
