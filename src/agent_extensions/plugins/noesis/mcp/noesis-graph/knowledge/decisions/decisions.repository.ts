import { Injectable } from "@nestjs/common";
import { z } from "zod";
import { DatabaseService } from "../../database/database.service.js";
import { assertNever } from "../../../../shared-contracts/assert-never.js";
import type {
  Decision,
  DecisionOption,
  TopicItem,
} from "../../../../shared-contracts/topics.js";
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
