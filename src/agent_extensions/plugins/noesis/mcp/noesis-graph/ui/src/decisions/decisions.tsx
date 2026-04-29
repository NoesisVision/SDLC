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
  IconArrowLeft,
  IconChevronRight,
  IconFileText,
  IconGavel,
  IconMessageCircle,
} from "@tabler/icons-react";
import { MarkdownContent } from "../shared/markdown-content.js";
import { InlineEdit } from "../shared/inline-edit.js";
import { SyncBadges } from "../shared/sync-badges.js";
import {
  categoryColor,
  groupIdeaUnitsByTurn,
} from "../shared/idea-units.js";
import classes from "./decisions.module.css";
import type {
  DecisionConversationDetailData,
  DecisionConversationRef,
  DecisionDetailData,
  DecisionDocumentDetailData,
  DecisionDocumentRef,
  DecisionListItem,
  DecisionSlotPath,
  DecisionsPageData,
} from "../../../ui-contracts/decisions/decisions-data.js";

type View =
  | { kind: "decision"; decisionId: string }
  | {
      kind: "conversation";
      decisionId: string;
      slot: DecisionSlotPath;
      slotLabel: string;
      conversation: DecisionConversationRef;
    }
  | {
      kind: "document";
      decisionId: string;
      slot: DecisionSlotPath;
      slotLabel: string;
      document: DecisionDocumentRef;
    };

interface NavState {
  current: View | null;
  stack: View[];
}

export function DecisionsPage() {
  const [data, setData] = useState<DecisionsPageData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [nav, setNav] = useState<NavState>({ current: null, stack: [] });

  useEffect(() => {
    fetch("/api/ui/decisions")
      .then((res) => {
        if (!res.ok) throw new Error(`Failed to load decisions (${res.status})`);
        return res.json() as Promise<DecisionsPageData>;
      })
      .then((d) => setData(d))
      .catch((err: Error) => setError(err.message));
  }, []);

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

  const selectDecision = useCallback(
    (id: string) => pushView({ kind: "decision", decisionId: id }),
    [pushView],
  );

  const hasDecisions = data !== null && data.decisions.length > 0;
  const activeDecisionId =
    nav.current !== null ? viewDecisionId(nav.current) : null;

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
                    active={d.id === activeDecisionId}
                    onSelect={() => selectDecision(d.id)}
                  />
                ))}
              </Stack>
            </Box>
          </Box>

          <Box className={classes.detailsColumn}>
            <DetailsPanel
              current={nav.current}
              canGoBack={nav.stack.length > 0}
              onBack={goBack}
              onSelectConversation={(decisionId, slot, slotLabel, conversation) =>
                pushView({
                  kind: "conversation",
                  decisionId,
                  slot,
                  slotLabel,
                  conversation,
                })
              }
              onSelectDocument={(decisionId, slot, slotLabel, document) =>
                pushView({
                  kind: "document",
                  decisionId,
                  slot,
                  slotLabel,
                  document,
                })
              }
            />
          </Box>
        </Box>
      ) : data !== null ? (
        <EmptyState />
      ) : null}
    </Box>
  );
}

function viewDecisionId(view: View): string {
  return view.decisionId;
}

function isSameView(a: View, b: View): boolean {
  if (a.kind !== b.kind) return false;
  if (a.kind === "decision" && b.kind === "decision")
    return a.decisionId === b.decisionId;
  if (a.kind === "conversation" && b.kind === "conversation")
    return (
      a.decisionId === b.decisionId &&
      a.slot === b.slot &&
      a.conversation.conversation_id === b.conversation.conversation_id
    );
  if (a.kind === "document" && b.kind === "document")
    return (
      a.decisionId === b.decisionId &&
      a.slot === b.slot &&
      a.document.document_id === b.document.document_id
    );
  return false;
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
          <Group gap={4}>
            <SyncBadges
              is_stale={decision.is_stale}
              edited_by_user={decision.edited_by_user}
            />
            <StatusBadge status={decision.status} />
          </Group>
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

type SelectConversationFn = (
  decisionId: string,
  slot: DecisionSlotPath,
  slotLabel: string,
  conversation: DecisionConversationRef,
) => void;

type SelectDocumentFn = (
  decisionId: string,
  slot: DecisionSlotPath,
  slotLabel: string,
  document: DecisionDocumentRef,
) => void;

function DetailsPanel({
  current,
  canGoBack,
  onBack,
  onSelectConversation,
  onSelectDocument,
}: {
  current: View | null;
  canGoBack: boolean;
  onBack: () => void;
  onSelectConversation: SelectConversationFn;
  onSelectDocument: SelectDocumentFn;
}) {
  if (current === null) {
    return (
      <Box className={classes.detailsEmpty}>
        <Text size="sm" c="dimmed">
          Select a decision on the left to see details.
        </Text>
      </Box>
    );
  }

  return (
    <Box className={classes.detailsShell}>
      <Box className={classes.detailsHeader}>
        <BackButton canGoBack={canGoBack} onBack={onBack} />
      </Box>
      <Box className={classes.detailsBody}>
        {current.kind === "decision" && (
          <DecisionDetails
            decisionId={current.decisionId}
            onSelectConversation={onSelectConversation}
            onSelectDocument={onSelectDocument}
          />
        )}
        {current.kind === "conversation" && (
          <ConversationDetails
            decisionId={current.decisionId}
            slot={current.slot}
            slotLabel={current.slotLabel}
            conversation={current.conversation}
          />
        )}
        {current.kind === "document" && (
          <DocumentDetails
            decisionId={current.decisionId}
            slot={current.slot}
            slotLabel={current.slotLabel}
            document={current.document}
          />
        )}
      </Box>
    </Box>
  );
}

function BackButton({
  canGoBack,
  onBack,
}: {
  canGoBack: boolean;
  onBack: () => void;
}) {
  return (
    <UnstyledButton
      onClick={onBack}
      disabled={!canGoBack}
      className={classes.backButton}
      data-disabled={!canGoBack}
    >
      <IconArrowLeft size={14} stroke={1.75} />
      <span>Back</span>
    </UnstyledButton>
  );
}

type DecisionEditableFields = Partial<{
  title: string;
  context_text: string;
  decision_text: string;
  decision_rationale: string;
}>;

async function patchDecision(
  decisionId: string,
  fields: DecisionEditableFields,
): Promise<void> {
  const res = await fetch(`/api/ui/decisions/${encodeURIComponent(decisionId)}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(fields),
  });
  if (!res.ok) throw new Error(`Failed to save (${res.status})`);
}

async function patchAlternative(
  decisionId: string,
  optionIndex: number,
  fields: Partial<{ text: string; rationale: string }>,
): Promise<void> {
  const res = await fetch(
    `/api/ui/decisions/${encodeURIComponent(decisionId)}/alternatives/${optionIndex}`,
    {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(fields),
    },
  );
  if (!res.ok) throw new Error(`Failed to save (${res.status})`);
}

function DecisionDetails({
  decisionId,
  onSelectConversation,
  onSelectDocument,
}: {
  decisionId: string;
  onSelectConversation: SelectConversationFn;
  onSelectDocument: SelectDocumentFn;
}) {
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

  const updateField = useCallback(
    async (fields: DecisionEditableFields): Promise<void> => {
      await patchDecision(decisionId, fields);
      setData((prev) => (prev === null ? prev : { ...prev, ...fields }));
    },
    [decisionId],
  );

  const updateAlternative = useCallback(
    async (
      optionIndex: number,
      fields: Partial<{ text: string; rationale: string }>,
    ): Promise<void> => {
      await patchAlternative(decisionId, optionIndex, fields);
      setData((prev) => {
        if (prev === null) return prev;
        return {
          ...prev,
          alternatives: prev.alternatives.map((a) =>
            a.option_index === optionIndex ? { ...a, ...fields } : a,
          ),
        };
      });
    },
    [decisionId],
  );

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
        <Group gap="sm" align="flex-start" wrap="nowrap">
          <ThemeIcon size="lg" variant="light" color="noesisIndigo" radius="sm">
            <IconGavel size={18} stroke={1.5} />
          </ThemeIcon>
          <Stack gap={6} style={{ flex: 1, minWidth: 0 }}>
            <InlineEdit
              value={data.title}
              mode="text"
              ariaLabel="Edit title"
              onSave={(next) => updateField({ title: next })}
              display={
                <Title order={1} size="h3" c="gray.1" fw={700}>
                  {data.title}
                </Title>
              }
            />
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
        <InlineEdit
          value={data.context_text}
          mode="textarea"
          block
          ariaLabel="Edit context"
          onSave={(next) => updateField({ context_text: next })}
          display={
            data.context_text === "" ? (
              <Text className={classes.sectionBody}>—</Text>
            ) : (
              <MarkdownContent text={data.context_text} />
            )
          }
        />
        <SourceLists
          decisionId={data.id}
          slot="context"
          slotLabel="Context"
          conversations={data.context_conversations}
          documents={data.context_documents}
          onSelectConversation={onSelectConversation}
          onSelectDocument={onSelectDocument}
        />
      </Box>

      <Box className={classes.section}>
        <Title order={2} size="h4" c="gray.1" fw={700} mb="xs">
          Decision
        </Title>
        <InlineEdit
          value={data.decision_text}
          mode="textarea"
          block
          ariaLabel="Edit decision"
          onSave={(next) => updateField({ decision_text: next })}
          display={
            data.decision_text === "" ? (
              <Text className={classes.sectionBody}>—</Text>
            ) : (
              <MarkdownContent text={data.decision_text} />
            )
          }
        />
        <Box className={classes.rationaleBlock}>
          <Text className={classes.rationaleLabel}>Rationale</Text>
          <InlineEdit
            value={data.decision_rationale}
            mode="textarea"
            block
            ariaLabel="Edit rationale"
            onSave={(next) => updateField({ decision_rationale: next })}
            display={
              data.decision_rationale === "" ? (
                <Text size="sm" c="dimmed">
                  No rationale.
                </Text>
              ) : (
                <MarkdownContent text={data.decision_rationale} variant="sm" italic />
              )
            }
          />
        </Box>
        <SourceLists
          decisionId={data.id}
          slot="decision"
          slotLabel="Decision"
          conversations={data.decision_conversations}
          documents={data.decision_documents}
          onSelectConversation={onSelectConversation}
          onSelectDocument={onSelectDocument}
        />
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
            {data.alternatives.map((a) => {
              const optionLabel = `Option ${a.option_index + 1}`;
              return (
                <Box key={a.option_index}>
                  <Title order={3} size="h5" c="gray.2" fw={600} mb={4}>
                    {optionLabel}
                  </Title>
                  <InlineEdit
                    value={a.text}
                    mode="textarea"
                    block
                    ariaLabel={`Edit ${optionLabel} text`}
                    onSave={(next) =>
                      updateAlternative(a.option_index, { text: next })
                    }
                    display={
                      a.text === "" ? (
                        <Text className={classes.sectionBody}>—</Text>
                      ) : (
                        <MarkdownContent text={a.text} />
                      )
                    }
                  />
                  <Box className={classes.rationaleBlock}>
                    <Text className={classes.rationaleLabel}>Rationale</Text>
                    <InlineEdit
                      value={a.rationale}
                      mode="textarea"
                      block
                      ariaLabel={`Edit ${optionLabel} rationale`}
                      onSave={(next) =>
                        updateAlternative(a.option_index, { rationale: next })
                      }
                      display={
                        a.rationale === "" ? (
                          <Text size="sm" c="dimmed">
                            No rationale.
                          </Text>
                        ) : (
                          <MarkdownContent
                            text={a.rationale}
                            variant="sm"
                            italic
                          />
                        )
                      }
                    />
                  </Box>
                  <SourceLists
                    decisionId={data.id}
                    slot={`alternative-${a.option_index}` as DecisionSlotPath}
                    slotLabel={optionLabel}
                    conversations={a.conversations}
                    documents={a.documents}
                    onSelectConversation={onSelectConversation}
                    onSelectDocument={onSelectDocument}
                  />
                </Box>
              );
            })}
          </Stack>
        )}
      </Box>
    </Stack>
  );
}

function SourceLists({
  decisionId,
  slot,
  slotLabel,
  conversations,
  documents,
  onSelectConversation,
  onSelectDocument,
}: {
  decisionId: string;
  slot: DecisionSlotPath;
  slotLabel: string;
  conversations: DecisionConversationRef[];
  documents: DecisionDocumentRef[];
  onSelectConversation: SelectConversationFn;
  onSelectDocument: SelectDocumentFn;
}) {
  if (conversations.length === 0 && documents.length === 0) return null;
  return (
    <Stack gap="sm" mt="md">
      {conversations.length > 0 && (
        <Stack gap={4}>
          <SubsectionLabel>Conversations</SubsectionLabel>
          <Stack gap={4}>
            {conversations.map((c) => (
              <ConversationRow
                key={c.conversation_id}
                conversation={c}
                onSelect={() =>
                  onSelectConversation(decisionId, slot, slotLabel, c)
                }
              />
            ))}
          </Stack>
        </Stack>
      )}
      {documents.length > 0 && (
        <Stack gap={4}>
          <SubsectionLabel>Documents</SubsectionLabel>
          <Stack gap={4}>
            {documents.map((d) => (
              <DocumentRow
                key={d.document_id}
                document={d}
                onSelect={() => onSelectDocument(decisionId, slot, slotLabel, d)}
              />
            ))}
          </Stack>
        </Stack>
      )}
    </Stack>
  );
}

function SubsectionLabel({ children }: { children: React.ReactNode }) {
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
  conversation: DecisionConversationRef;
  onSelect: () => void;
}) {
  return (
    <UnstyledButton
      onClick={onSelect}
      py={8}
      px="sm"
      w="100%"
      className={`${classes.refRow} ${classes.refRowClickable}`}
    >
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
  document: DecisionDocumentRef;
  onSelect: () => void;
}) {
  return (
    <UnstyledButton
      onClick={onSelect}
      py={8}
      px="sm"
      w="100%"
      className={`${classes.refRow} ${classes.refRowClickable}`}
    >
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
  decisionId,
  slot,
  slotLabel,
  conversation,
}: {
  decisionId: string;
  slot: DecisionSlotPath;
  slotLabel: string;
  conversation: DecisionConversationRef;
}) {
  const [data, setData] = useState<DecisionConversationDetailData | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setData(null);
    setError(null);
    fetch(
      `/api/ui/decisions/${encodeURIComponent(decisionId)}/slots/${encodeURIComponent(slot)}/conversations/${encodeURIComponent(conversation.conversation_id)}`,
    )
      .then((res) => {
        if (!res.ok) throw new Error(`Failed to load conversation (${res.status})`);
        return res.json() as Promise<DecisionConversationDetailData>;
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
  }, [decisionId, slot, conversation.conversation_id]);

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
            Loading {conversation.title}
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
                {data.decision_title} — {slotLabel}
              </Text>
            </Group>
          </Stack>
        </Group>

        {turnGroups.length === 0 ? (
          <Text size="sm" c="dimmed">
            No idea units linked to this slot from this conversation.
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
  decisionId,
  slot,
  slotLabel,
  document,
}: {
  decisionId: string;
  slot: DecisionSlotPath;
  slotLabel: string;
  document: DecisionDocumentRef;
}) {
  const [data, setData] = useState<DecisionDocumentDetailData | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setData(null);
    setError(null);
    fetch(
      `/api/ui/decisions/${encodeURIComponent(decisionId)}/slots/${encodeURIComponent(slot)}/documents/${encodeURIComponent(document.document_id)}`,
    )
      .then((res) => {
        if (!res.ok) throw new Error(`Failed to load document (${res.status})`);
        return res.json() as Promise<DecisionDocumentDetailData>;
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
  }, [decisionId, slot, document.document_id]);

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
            Loading {document.title}
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
                {data.decision_title} — {slotLabel}
              </Text>
            </Group>
          </Stack>
        </Group>

        {data.fragments.length === 0 ? (
          <Text size="sm" c="dimmed">
            No document fragments linked to this slot from this document.
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
        <IconGavel size={40} stroke={1} color="var(--mantine-color-gray-5)" />
        <Text size="sm" c="dimmed">
          No decisions yet. Extract decisions from a topic to populate this list.
        </Text>
      </Stack>
    </Card>
  );
}
