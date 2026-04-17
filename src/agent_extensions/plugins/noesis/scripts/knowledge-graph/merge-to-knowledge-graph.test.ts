import { describe, expect, test } from "bun:test";
import { mergeToKnowledgeGraph } from "./merge-to-knowledge-graph.js";
import type { Conversation } from "../../shared-contracts/conversation.js";
import type { KnowledgeGraph } from "../../shared-contracts/knowledge-graph.js";

function makeConversation(): Conversation {
  return {
    conversation_id: "conv-1",
    time: "2026-01-15 10:00:00",
    main_topic: "Architecture",
    turns: [
      {
        index: 0,
        speaker: "Alice",
        time: "00:01:00",
        idea_units: [
          { index: 0, sentences: ["Point A."], categories: ["Information"] },
        ],
      },
    ],
    topics: [
      {
        id: "topic-1",
        title: "Microservices",
        short_summary: "MS summary",
        long_summary: "MS long summary",
        items: [
          { type: "conversation_idea_unit", conversation_id: "conv-1", turn_index: 0, idea_unit_index: 0 },
        ],
        subtopics: [],
        reviewed: true,
        decisions_extracted: true,
      },
    ],
    decisions: [
      {
        title: "Use microservices",
        status: "accepted",
        context: { text: "Arch discussion", supporting_items: [] },
        decision: { text: "Go micro", rationale: "Scale", supporting_items: [] },
        alternative_options: [],
      },
    ],
  };
}

function makeEmptyKg(): KnowledgeGraph {
  return { conversations: [], topics: [], decisions: [] };
}

describe("mergeToKnowledgeGraph", () => {
  test("merges conversation summary into empty KG", () => {
    const conv = makeConversation();
    const kg = makeEmptyKg();
    mergeToKnowledgeGraph(conv, kg, new Map());

    expect(kg.conversations).toHaveLength(1);
    expect(kg.conversations[0].conversation_id).toBe("conv-1");
    expect(kg.conversations[0].turns).toHaveLength(1);
  });

  test("replaces existing conversation summary", () => {
    const conv = makeConversation();
    const kg = makeEmptyKg();
    kg.conversations.push({
      conversation_id: "conv-1",
      time: "2025-01-01 00:00:00",
      main_topic: "Old topic",
      turns: [],
    });

    mergeToKnowledgeGraph(conv, kg, new Map());

    expect(kg.conversations).toHaveLength(1);
    expect(kg.conversations[0].main_topic).toBe("Architecture");
    expect(kg.conversations[0].turns).toHaveLength(1);
  });

  test("merges new topic into KG at root level", () => {
    const conv = makeConversation();
    const kg = makeEmptyKg();
    mergeToKnowledgeGraph(conv, kg, new Map());

    expect(kg.topics).toHaveLength(1);
    expect(kg.topics[0].id).toBe("topic-1");
    expect(kg.topics[0].title).toBe("Microservices");
    expect(kg.topics[0].items).toHaveLength(1);
  });

  test("inserts topic under parent when parent_map specifies", () => {
    const conv = makeConversation();
    const kg = makeEmptyKg();
    kg.topics.push({
      id: "parent-1",
      title: "Architecture",
      short_summary: "",
      long_summary: "",
      items: [],
      subtopics: [],
      reviewed: false,
      decisions_extracted: false,
    });

    const parentMap = new Map<string, string | null>([["topic-1", "parent-1"]]);
    mergeToKnowledgeGraph(conv, kg, parentMap);

    expect(kg.topics).toHaveLength(1);
    expect(kg.topics[0].subtopics).toHaveLength(1);
    expect(kg.topics[0].subtopics[0].id).toBe("topic-1");
  });

  test("updates existing topic with new data", () => {
    const conv = makeConversation();
    const kg = makeEmptyKg();
    kg.topics.push({
      id: "topic-1",
      title: "Old title",
      short_summary: "Old",
      long_summary: "Old long",
      items: [
        { type: "conversation_idea_unit", conversation_id: "conv-old", turn_index: 0, idea_unit_index: 0 },
      ],
      subtopics: [],
      reviewed: false,
      decisions_extracted: false,
    });

    mergeToKnowledgeGraph(conv, kg, new Map());

    expect(kg.topics[0].title).toBe("Microservices");
    expect(kg.topics[0].short_summary).toBe("MS summary");
    expect(kg.topics[0].items).toHaveLength(2);
  });

  test("deduplicates idea unit refs when updating", () => {
    const conv = makeConversation();
    const kg = makeEmptyKg();
    kg.topics.push({
      id: "topic-1",
      title: "Old",
      short_summary: "",
      long_summary: "",
      items: [
        { type: "conversation_idea_unit", conversation_id: "conv-1", turn_index: 0, idea_unit_index: 0 },
      ],
      subtopics: [],
      reviewed: false,
      decisions_extracted: false,
    });

    mergeToKnowledgeGraph(conv, kg, new Map());
    expect(kg.topics[0].items).toHaveLength(1);
  });

  test("deduplicates document_fragment items using offsets", () => {
    const conv = makeConversation();
    conv.topics[0].items.push({
      type: "document_fragment",
      document_id: "doc-1",
      start_offset: 0,
      end_offset: 50,
    });
    const kg = makeEmptyKg();
    kg.topics.push({
      id: "topic-1",
      title: "Old",
      short_summary: "",
      long_summary: "",
      items: [
        { type: "document_fragment", document_id: "doc-1", start_offset: 0, end_offset: 50 },
      ],
      subtopics: [],
      reviewed: false,
      decisions_extracted: false,
    });

    mergeToKnowledgeGraph(conv, kg, new Map());
    const fragments = kg.topics[0].items.filter((it) => it.type === "document_fragment");
    expect(fragments).toHaveLength(1);
  });

  test("reparents topic when parent changes", () => {
    const conv = makeConversation();
    const kg = makeEmptyKg();
    kg.topics.push(
      {
        id: "topic-1",
        title: "Old",
        short_summary: "",
        long_summary: "",
        items: [],
        subtopics: [],
        reviewed: false,
        decisions_extracted: false,
      },
      {
        id: "new-parent",
        title: "New Parent",
        short_summary: "",
        long_summary: "",
        items: [],
        subtopics: [],
        reviewed: false,
        decisions_extracted: false,
      },
    );

    const parentMap = new Map<string, string | null>([["topic-1", "new-parent"]]);
    mergeToKnowledgeGraph(conv, kg, parentMap);

    expect(kg.topics).toHaveLength(1);
    expect(kg.topics[0].id).toBe("new-parent");
    expect(kg.topics[0].subtopics).toHaveLength(1);
    expect(kg.topics[0].subtopics[0].id).toBe("topic-1");
  });

  test("merges decisions", () => {
    const conv = makeConversation();
    const kg = makeEmptyKg();
    mergeToKnowledgeGraph(conv, kg, new Map());

    expect(kg.decisions).toHaveLength(1);
    expect(kg.decisions[0].title).toBe("Use microservices");
  });

  test("falls back to root when parent not found", () => {
    const conv = makeConversation();
    const kg = makeEmptyKg();
    const parentMap = new Map<string, string | null>([["topic-1", "nonexistent"]]);

    mergeToKnowledgeGraph(conv, kg, parentMap);

    expect(kg.topics).toHaveLength(1);
    expect(kg.topics[0].id).toBe("topic-1");
  });
});
