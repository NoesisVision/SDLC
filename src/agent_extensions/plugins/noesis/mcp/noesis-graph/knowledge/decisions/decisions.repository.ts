import { Injectable } from "@nestjs/common";
import { z } from "zod";
import { DatabaseService, type QueryParams } from "../../database/database.service.js";
import { assertNever } from "../../../../shared-contracts/assert-never.js";
import type { IdeaUnitDetail } from "../../../../shared-contracts/conversation.js";
import type {
  Decision,
  DecisionOption,
  TopicItem,
} from "../../../../shared-contracts/topics.js";
import type { TopicDocumentFragment } from "../../ui-contracts/topics/topics-data.js";
import { alternativeOptionNodeId } from "./node-ids.js";
import type { DecisionSupportSlot } from "./decision-support.js";

const DecisionOverviewRowSchema = z.object({
  id: z.string(),
  topic_id: z.string(),
  topic_title: z.string(),
  title: z.string(),
  status: z.string(),
  context_text: z.string(),
});
type DecisionOverviewRow = z.infer<typeof DecisionOverviewRowSchema>;

const DecisionDetailRowSchema = DecisionOverviewRowSchema.extend({
  decision_text: z.string(),
  decision_rationale: z.string(),
});
type DecisionDetailRow = z.infer<typeof DecisionDetailRowSchema>;

const AlternativeRowSchema = z.object({
  option_index: z.union([z.number(), z.bigint()]),
  text: z.string(),
  rationale: z.string(),
});
type AlternativeRowRaw = z.infer<typeof AlternativeRowSchema>;

const IdRowSchema = z.object({ id: z.string() });
type IdRow = z.infer<typeof IdRowSchema>;

const ConversationRefRowSchema = z.object({
  conversation_id: z.string(),
  title: z.string(),
  date: z.string(),
});
type ConversationRefRow = z.infer<typeof ConversationRefRowSchema>;

const DocumentRefRowSchema = z.object({
  document_id: z.string(),
  title: z.string(),
  date: z.string(),
});
type DocumentRefRow = z.infer<typeof DocumentRefRowSchema>;

const IdeaUnitJoinRowSchema = z.object({
  conversation_id: z.string(),
  turn_index: z.union([z.number(), z.bigint()]),
  idea_unit_index: z.union([z.number(), z.bigint()]),
  sentences: z.array(z.string()),
  categories: z.array(z.string()),
  speaker: z.string(),
  time: z.string(),
});
type IdeaUnitJoinRow = z.infer<typeof IdeaUnitJoinRowSchema>;

const DocumentFragmentJoinRowSchema = z.object({
  start_offset: z.union([z.number(), z.bigint()]),
  end_offset: z.union([z.number(), z.bigint()]),
  document_content: z.string(),
});
type DocumentFragmentJoinRow = z.infer<typeof DocumentFragmentJoinRowSchema>;

const ConversationHeadRowSchema = z.object({
  conversation_id: z.string(),
  main_topic: z.string(),
  time: z.string(),
});
type ConversationHeadRow = z.infer<typeof ConversationHeadRowSchema>;

const DocumentHeadRowSchema = z.object({
  document_id: z.string(),
  title: z.string(),
  date: z.string(),
});
type DocumentHeadRow = z.infer<typeof DocumentHeadRowSchema>;

export interface ConversationHead {
  conversation_id: string;
  main_topic: string;
  time: string;
}

export interface DocumentHead {
  document_id: string;
  title: string;
  date: string;
}

export interface DecisionConversationRef {
  conversation_id: string;
  title: string;
  date: string;
}

export interface DecisionDocumentRef {
  document_id: string;
  title: string;
  date: string;
}

export interface DecisionOverview {
  id: string;
  topic_id: string;
  topic_title: string;
  title: string;
  status: string;
  context_text: string;
}

export interface AlternativeRow {
  option_index: number;
  text: string;
  rationale: string;
}

export interface DecisionDetail {
  id: string;
  topic_id: string;
  topic_title: string;
  title: string;
  status: string;
  context_text: string;
  decision_text: string;
  decision_rationale: string;
  alternatives: AlternativeRow[];
}

export interface DecisionDateEntry {
  id: string;
  date: string;
}

@Injectable()
export class DecisionsRepository {
  constructor(private readonly db: DatabaseService) {}

  async ensureNotExists(decisionId: string): Promise<void> {
    if (await this.exists(decisionId)) {
      throw new Error(`Decision already exists: ${decisionId}`);
    }
  }

  async exists(decisionId: string): Promise<boolean> {
    const rows = await this.db.query<IdRow>(
      "MATCH (d:Decision) WHERE d.id = $id RETURN d.id AS id LIMIT 1",
      { id: decisionId },
    );
    return rows.length > 0;
  }

  async insertAlternativeOption(
    altId: string,
    optionIndex: number,
    option: DecisionOption,
  ): Promise<void> {
    await this.db.query(
      "CREATE (a:AlternativeOption {id: $id, option_index: $option_index, text: $text, rationale: $rationale})",
      {
        id: altId,
        option_index: optionIndex,
        text: option.text,
        rationale: option.rationale,
      },
    );
  }

  async insertDecisionNode(decision: Decision): Promise<void> {
    await this.db.query(
      "CREATE (d:Decision {id: $id, title: $title, status: $status, context_text: $context_text, decision_text: $decision_text, decision_rationale: $decision_rationale})",
      {
        id: decision.id,
        title: decision.title,
        status: decision.status,
        context_text: decision.context.text,
        decision_text: decision.decision.text,
        decision_rationale: decision.decision.rationale,
      },
    );
  }

  async linkAlternativeToFragment(
    altId: string,
    fragId: string,
  ): Promise<void> {
    await this.db.query(
      "MATCH (a:AlternativeOption), (f:DocumentFragment) WHERE a.id = $altId AND f.id = $fragId CREATE (a)-[:ALTERNATIVE_SUPPORTED_BY_DOC_FRAGMENT]->(f)",
      { altId, fragId },
    );
  }

  async linkAlternativeToIdeaUnit(
    altId: string,
    iuId: string,
  ): Promise<void> {
    await this.db.query(
      "MATCH (a:AlternativeOption), (u:IdeaUnit) WHERE a.id = $altId AND u.id = $iuId CREATE (a)-[:ALTERNATIVE_SUPPORTED_BY_IDEA_UNIT]->(u)",
      { altId, iuId },
    );
  }

  async linkDecisionSlotToFragment(
    decisionId: string,
    slot: DecisionSupportSlot,
    fragId: string,
  ): Promise<void> {
    const relName = decisionSlotRelName(slot, "document_fragment_ref");
    await this.db.query(
      `MATCH (d:Decision), (f:DocumentFragment) WHERE d.id = $decisionId AND f.id = $fragId CREATE (d)-[:${relName}]->(f)`,
      { decisionId, fragId },
    );
  }

  async linkDecisionSlotToIdeaUnit(
    decisionId: string,
    slot: DecisionSupportSlot,
    iuId: string,
  ): Promise<void> {
    const relName = decisionSlotRelName(slot, "idea_unit_ref");
    await this.db.query(
      `MATCH (d:Decision), (u:IdeaUnit) WHERE d.id = $decisionId AND u.id = $iuId CREATE (d)-[:${relName}]->(u)`,
      { decisionId, iuId },
    );
  }

  async linkDecisionToAlternative(
    decisionId: string,
    altId: string,
  ): Promise<void> {
    await this.db.query(
      "MATCH (d:Decision), (a:AlternativeOption) WHERE d.id = $decisionId AND a.id = $altId CREATE (d)-[:DECISION_HAS_ALTERNATIVE]->(a)",
      { decisionId, altId },
    );
  }

  async linkTopicToDecision(
    topicId: string,
    decisionId: string,
  ): Promise<void> {
    await this.db.query(
      "MATCH (t:Topic), (d:Decision) WHERE t.id = $topicId AND d.id = $decisionId CREATE (t)-[:TOPIC_HAS_DECISION]->(d)",
      { topicId, decisionId },
    );
  }

  async listConversationsForDecisionSlot(
    decisionId: string,
    slot: DecisionSupportSlot,
  ): Promise<DecisionConversationRef[]> {
    const cypher = decisionSlotConversationCypher(slot);
    const params = decisionSlotParams(decisionId, slot);
    const rawRows = await this.db.query<ConversationRefRow>(cypher, params);
    return z.array(ConversationRefRowSchema).parse(rawRows);
  }

  async listDocumentsForDecisionSlot(
    decisionId: string,
    slot: DecisionSupportSlot,
  ): Promise<DecisionDocumentRef[]> {
    const cypher = decisionSlotDocumentCypher(slot);
    const params = decisionSlotParams(decisionId, slot);
    const rawRows = await this.db.query<DocumentRefRow>(cypher, params);
    return z.array(DocumentRefRowSchema).parse(rawRows);
  }

  async listFragmentsForDecisionSlotAndDocument(
    decisionId: string,
    slot: DecisionSupportSlot,
    documentId: string,
  ): Promise<TopicDocumentFragment[]> {
    const cypher =
      `${decisionSlotMatch(slot, "DOC_FRAGMENT")}` +
      `(f:DocumentFragment)<-[:DOCUMENT_HAS_FRAGMENT]-(doc:Document) ` +
      `${decisionSlotWhere(slot)} AND doc.id = $documentId ` +
      `RETURN f.start_offset AS start_offset, f.end_offset AS end_offset, doc.content AS document_content ` +
      `ORDER BY f.start_offset`;
    const params = { ...decisionSlotParams(decisionId, slot), documentId };
    const rawRows = await this.db.query<DocumentFragmentJoinRow>(cypher, params);
    const rows = z.array(DocumentFragmentJoinRowSchema).parse(rawRows);
    return rows.map((r) => {
      const start = Number(r.start_offset);
      const end = Number(r.end_offset);
      return {
        start_offset: start,
        end_offset: end,
        text: r.document_content.slice(start, end),
      };
    });
  }

  async listIdeaUnitsForDecisionSlotAndConversation(
    decisionId: string,
    slot: DecisionSupportSlot,
    conversationId: string,
  ): Promise<IdeaUnitDetail[]> {
    const cypher =
      `${decisionSlotMatch(slot, "IDEA_UNIT")}` +
      `(u:IdeaUnit)<-[:TURN_HAS_IDEA_UNIT]-(turn:Turn) ` +
      `${decisionSlotWhere(slot)} AND u.conversation_id = $conversationId ` +
      `RETURN u.conversation_id AS conversation_id, u.turn_index AS turn_index, u.idea_unit_index AS idea_unit_index, ` +
      `u.sentences AS sentences, u.categories AS categories, turn.speaker AS speaker, turn.time AS time ` +
      `ORDER BY u.turn_index, u.idea_unit_index`;
    const params = { ...decisionSlotParams(decisionId, slot), conversationId };
    const rawRows = await this.db.query<IdeaUnitJoinRow>(cypher, params);
    const rows = z.array(IdeaUnitJoinRowSchema).parse(rawRows);
    return rows.map((r) => ({
      conversation_id: r.conversation_id,
      turn_index: Number(r.turn_index),
      idea_unit_index: Number(r.idea_unit_index),
      speaker: r.speaker,
      time: r.time,
      sentences: r.sentences,
      categories: r.categories as IdeaUnitDetail["categories"],
    }));
  }

  async readConversationHead(
    conversationId: string,
  ): Promise<ConversationHead | null> {
    const rawRows = await this.db.query<ConversationHeadRow>(
      "MATCH (c:Conversation) WHERE c.id = $id " +
        "RETURN c.id AS conversation_id, c.main_topic AS main_topic, c.time AS time LIMIT 1",
      { id: conversationId },
    );
    if (rawRows.length === 0) return null;
    return ConversationHeadRowSchema.parse(rawRows[0]);
  }

  async readDocumentHead(documentId: string): Promise<DocumentHead | null> {
    const rawRows = await this.db.query<DocumentHeadRow>(
      "MATCH (d:Document) WHERE d.id = $id " +
        "RETURN d.id AS document_id, d.title AS title, d.date AS date LIMIT 1",
      { id: documentId },
    );
    if (rawRows.length === 0) return null;
    return DocumentHeadRowSchema.parse(rawRows[0]);
  }

  async listDecisionSourceDates(): Promise<DecisionDateEntry[]> {
    const DateRowSchema = z.object({ id: z.string(), date: z.string() });
    const queries = [
      "MATCH (d:Decision)-[:CONTEXT_SUPPORTED_BY_IDEA_UNIT]->(:IdeaUnit)<-[:TURN_HAS_IDEA_UNIT]-(:Turn)<-[:CONVERSATION_HAS_TURN]-(c:Conversation) RETURN d.id AS id, c.time AS date",
      "MATCH (d:Decision)-[:DECISION_SUPPORTED_BY_IDEA_UNIT]->(:IdeaUnit)<-[:TURN_HAS_IDEA_UNIT]-(:Turn)<-[:CONVERSATION_HAS_TURN]-(c:Conversation) RETURN d.id AS id, c.time AS date",
      "MATCH (d:Decision)-[:DECISION_HAS_ALTERNATIVE]->(:AlternativeOption)-[:ALTERNATIVE_SUPPORTED_BY_IDEA_UNIT]->(:IdeaUnit)<-[:TURN_HAS_IDEA_UNIT]-(:Turn)<-[:CONVERSATION_HAS_TURN]-(c:Conversation) RETURN d.id AS id, c.time AS date",
      "MATCH (d:Decision)-[:CONTEXT_SUPPORTED_BY_DOC_FRAGMENT]->(:DocumentFragment)<-[:DOCUMENT_HAS_FRAGMENT]-(doc:Document) RETURN d.id AS id, doc.date AS date",
      "MATCH (d:Decision)-[:DECISION_SUPPORTED_BY_DOC_FRAGMENT]->(:DocumentFragment)<-[:DOCUMENT_HAS_FRAGMENT]-(doc:Document) RETURN d.id AS id, doc.date AS date",
      "MATCH (d:Decision)-[:DECISION_HAS_ALTERNATIVE]->(:AlternativeOption)-[:ALTERNATIVE_SUPPORTED_BY_DOC_FRAGMENT]->(:DocumentFragment)<-[:DOCUMENT_HAS_FRAGMENT]-(doc:Document) RETURN d.id AS id, doc.date AS date",
    ];
    const all: DecisionDateEntry[] = [];
    for (const q of queries) {
      const rows = await this.db.query<unknown>(q);
      for (const row of z.array(DateRowSchema).parse(rows)) {
        all.push(row);
      }
    }
    return all;
  }

  async listDecisionIdsForSources(
    conversationIds: string[],
    documentIds: string[],
  ): Promise<string[]> {
    const ids = new Set<string>();
    if (conversationIds.length > 0) {
      const queries = [
        "MATCH (d:Decision)-[:CONTEXT_SUPPORTED_BY_IDEA_UNIT]->(u:IdeaUnit) WHERE u.conversation_id IN $ids RETURN DISTINCT d.id AS id",
        "MATCH (d:Decision)-[:DECISION_SUPPORTED_BY_IDEA_UNIT]->(u:IdeaUnit) WHERE u.conversation_id IN $ids RETURN DISTINCT d.id AS id",
        "MATCH (d:Decision)-[:DECISION_HAS_ALTERNATIVE]->(:AlternativeOption)-[:ALTERNATIVE_SUPPORTED_BY_IDEA_UNIT]->(u:IdeaUnit) WHERE u.conversation_id IN $ids RETURN DISTINCT d.id AS id",
      ];
      for (const q of queries) {
        const rows = await this.db.query<IdRow>(q, { ids: conversationIds });
        for (const row of z.array(IdRowSchema).parse(rows)) {
          ids.add(row.id);
        }
      }
    }
    if (documentIds.length > 0) {
      const queries = [
        "MATCH (d:Decision)-[:CONTEXT_SUPPORTED_BY_DOC_FRAGMENT]->(f:DocumentFragment) WHERE f.document_id IN $ids RETURN DISTINCT d.id AS id",
        "MATCH (d:Decision)-[:DECISION_SUPPORTED_BY_DOC_FRAGMENT]->(f:DocumentFragment) WHERE f.document_id IN $ids RETURN DISTINCT d.id AS id",
        "MATCH (d:Decision)-[:DECISION_HAS_ALTERNATIVE]->(:AlternativeOption)-[:ALTERNATIVE_SUPPORTED_BY_DOC_FRAGMENT]->(f:DocumentFragment) WHERE f.document_id IN $ids RETURN DISTINCT d.id AS id",
      ];
      for (const q of queries) {
        const rows = await this.db.query<IdRow>(q, { ids: documentIds });
        for (const row of z.array(IdRowSchema).parse(rows)) {
          ids.add(row.id);
        }
      }
    }
    return Array.from(ids);
  }

  async listDecisions(
    topicId: string | null,
  ): Promise<DecisionOverview[]> {
    const rawRows = topicId === null
      ? await this.db.query<DecisionOverviewRow>(
          "MATCH (t:Topic)-[:TOPIC_HAS_DECISION]->(d:Decision) " +
            "RETURN d.id AS id, t.id AS topic_id, t.title AS topic_title, d.title AS title, d.status AS status, d.context_text AS context_text " +
            "ORDER BY t.title, d.title",
        )
      : await this.db.query<DecisionOverviewRow>(
          "MATCH (t:Topic)-[:TOPIC_HAS_DECISION]->(d:Decision) WHERE t.id = $topicId " +
            "RETURN d.id AS id, t.id AS topic_id, t.title AS topic_title, d.title AS title, d.status AS status, d.context_text AS context_text " +
            "ORDER BY d.title",
          { topicId },
        );
    return z.array(DecisionOverviewRowSchema).parse(rawRows);
  }

  async readDecision(decisionId: string): Promise<DecisionDetail | null> {
    const rawHead = await this.db.query<DecisionDetailRow>(
      "MATCH (t:Topic)-[:TOPIC_HAS_DECISION]->(d:Decision) WHERE d.id = $id " +
        "RETURN d.id AS id, t.id AS topic_id, t.title AS topic_title, d.title AS title, d.status AS status, " +
        "d.context_text AS context_text, d.decision_text AS decision_text, d.decision_rationale AS decision_rationale " +
        "LIMIT 1",
      { id: decisionId },
    );
    if (rawHead.length === 0) return null;
    const head = DecisionDetailRowSchema.parse(rawHead[0]);

    const rawAlts = await this.db.query<AlternativeRowRaw>(
      "MATCH (d:Decision)-[:DECISION_HAS_ALTERNATIVE]->(a:AlternativeOption) WHERE d.id = $id " +
        "RETURN a.option_index AS option_index, a.text AS text, a.rationale AS rationale " +
        "ORDER BY a.option_index",
      { id: decisionId },
    );
    const alts = z.array(AlternativeRowSchema).parse(rawAlts);

    return {
      ...head,
      alternatives: alts.map((r) => ({
        option_index: Number(r.option_index),
        text: r.text,
        rationale: r.rationale,
      })),
    };
  }

  async updateDecisionFields(
    decisionId: string,
    fields: Partial<{
      title: string;
      status: string;
      context_text: string;
      decision_text: string;
      decision_rationale: string;
    }>,
  ): Promise<void> {
    const keys = Object.keys(fields);
    if (keys.length === 0) return;
    const setClause = keys.map((k) => `d.${k} = $${k}`).join(", ");
    await this.db.query(
      `MATCH (d:Decision) WHERE d.id = $id SET ${setClause}`,
      { id: decisionId, ...fields },
    );
  }

  async updateAlternativeFields(
    decisionId: string,
    optionIndex: number,
    fields: Partial<{ text: string; rationale: string }>,
  ): Promise<void> {
    const keys = Object.keys(fields);
    if (keys.length === 0) return;
    const altId = alternativeOptionNodeId(decisionId, optionIndex);
    const setClause = keys.map((k) => `a.${k} = $${k}`).join(", ");
    await this.db.query(
      `MATCH (a:AlternativeOption) WHERE a.id = $id SET ${setClause}`,
      { id: altId, ...fields },
    );
  }

  async requireAlternative(
    decisionId: string,
    optionIndex: number,
  ): Promise<void> {
    const altId = alternativeOptionNodeId(decisionId, optionIndex);
    const rows = await this.db.query<IdRow>(
      "MATCH (a:AlternativeOption) WHERE a.id = $id RETURN a.id AS id LIMIT 1",
      { id: altId },
    );
    if (rows.length === 0) {
      throw new Error(
        `Alternative option not found for decision ${decisionId} at index ${optionIndex}`,
      );
    }
  }

  async requireDecision(decisionId: string): Promise<void> {
    if (!(await this.exists(decisionId))) {
      throw new Error(`Decision not found: ${decisionId}`);
    }
  }
}

function decisionSlotConversationCypher(slot: DecisionSupportSlot): string {
  return (
    `${decisionSlotMatch(slot, "IDEA_UNIT")}(:IdeaUnit)<-[:TURN_HAS_IDEA_UNIT]-(:Turn)<-[:CONVERSATION_HAS_TURN]-(c:Conversation) ` +
    `${decisionSlotWhere(slot)} ` +
    `RETURN DISTINCT c.id AS conversation_id, c.main_topic AS title, c.time AS date ` +
    `ORDER BY date DESC`
  );
}

function decisionSlotDocumentCypher(slot: DecisionSupportSlot): string {
  return (
    `${decisionSlotMatch(slot, "DOC_FRAGMENT")}(:DocumentFragment)<-[:DOCUMENT_HAS_FRAGMENT]-(doc:Document) ` +
    `${decisionSlotWhere(slot)} ` +
    `RETURN DISTINCT doc.id AS document_id, doc.title AS title, doc.date AS date ` +
    `ORDER BY date DESC`
  );
}

function decisionSlotMatch(
  slot: DecisionSupportSlot,
  itemSuffix: "IDEA_UNIT" | "DOC_FRAGMENT",
): string {
  switch (slot.slot) {
    case "context":
      return `MATCH (d:Decision)-[:CONTEXT_SUPPORTED_BY_${itemSuffix}]->`;
    case "decision":
      return `MATCH (d:Decision)-[:DECISION_SUPPORTED_BY_${itemSuffix}]->`;
    case "alternative":
      return (
        `MATCH (d:Decision)-[:DECISION_HAS_ALTERNATIVE]->` +
        `(a:AlternativeOption)-[:ALTERNATIVE_SUPPORTED_BY_${itemSuffix}]->`
      );
    default:
      return assertNever(slot);
  }
}

function decisionSlotParams(
  decisionId: string,
  slot: DecisionSupportSlot,
): QueryParams {
  switch (slot.slot) {
    case "context":
    case "decision":
      return { decisionId };
    case "alternative":
      return { decisionId, optionIndex: slot.alternative_index };
    default:
      return assertNever(slot);
  }
}

function decisionSlotWhere(slot: DecisionSupportSlot): string {
  switch (slot.slot) {
    case "context":
    case "decision":
      return `WHERE d.id = $decisionId`;
    case "alternative":
      return `WHERE d.id = $decisionId AND a.option_index = $optionIndex`;
    default:
      return assertNever(slot);
  }
}

function decisionSlotRelName(
  slot: DecisionSupportSlot,
  itemType: TopicItem["type"],
): string {
  const suffix = itemSuffix(itemType);
  switch (slot.slot) {
    case "context":
      return `CONTEXT_SUPPORTED_BY_${suffix}`;
    case "decision":
      return `DECISION_SUPPORTED_BY_${suffix}`;
    case "alternative":
      return `ALTERNATIVE_SUPPORTED_BY_${suffix}`;
    default:
      return assertNever(slot);
  }
}

function itemSuffix(itemType: TopicItem["type"]): string {
  switch (itemType) {
    case "idea_unit_ref":
      return "IDEA_UNIT";
    case "document_fragment_ref":
      return "DOC_FRAGMENT";
    default:
      return assertNever(itemType);
  }
}
