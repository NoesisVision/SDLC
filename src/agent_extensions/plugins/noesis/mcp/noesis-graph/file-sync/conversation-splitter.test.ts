import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import {
  computeContentSha,
  conversationJsonPath,
  conversationMdPath,
  decisionJsonPath,
  topicJsonPath,
} from "../../../shared-contracts/source-files.js";
import {
  ConversationSidecarSchema,
  DecisionFileSchema,
  TopicFileSchema,
} from "../../../shared-contracts/source-file-schemas.js";
import type { AnalyzeConversationOutput } from "../../../shared-contracts/skills/analyze-conversation/output.js";
import { splitConversation } from "./conversation-splitter.js";

function buildOutput(overrides: Partial<AnalyzeConversationOutput> = {}): AnalyzeConversationOutput {
  return {
    conversation: {
      conversation_id: "convo-1",
      time: "2026-04-29 10:00:00",
      main_topic: "main",
      turns: [
        {
          index: 0,
          speaker: "Alice",
          time: "00:00",
          idea_units: [
            {
              index: 0,
              sentences: ["Hello."],
              categories: ["Information"],
            },
          ],
        },
      ],
      topics: [
        {
          id: "topic-1",
          title: "Topic One",
          short_summary: "Short.",
          long_summary: "Long.",
          items: [
            {
              type: "idea_unit_ref",
              conversation_id: "convo-1",
              turn_index: 0,
              idea_unit_index: 0,
            },
          ],
          decisions: [
            {
              id: "dec-1",
              title: "Decide",
              status: "accepted",
              referenced_items: [
                {
                  type: "idea_unit_ref",
                  conversation_id: "convo-1",
                  turn_index: 0,
                  idea_unit_index: 0,
                },
              ],
              context: { text: "ctx", supporting_item_indices: [0] },
              decision: { text: "go", rationale: "r", supporting_item_indices: [0] },
              alternative_options: [],
            },
          ],
          reviewed: true,
          decisions_extracted: true,
        },
      ],
      ...overrides.conversation === undefined ? {} : { conversation: overrides.conversation },
    },
    potential_topics: overrides.potential_topics ?? {
      topics: [
        {
          id: "topic-1",
          title: "Topic One",
          short_summary: "Short.",
          path: ["Topic One"],
          is_new: true,
          parent_id: null,
        },
      ],
    },
  };
}

describe("splitConversation", () => {
  let projectDir: string;
  let cleanedSource: string;

  beforeEach(() => {
    projectDir = mkdtempSync(join(tmpdir(), "noesis-split-conv-"));
    cleanedSource = join(projectDir, "raw-cleaned.md");
    writeFileSync(
      cleanedSource,
      "<!-- conversation_id: convo-1 -->\n# Hi\n",
    );
  });

  afterEach(() => {
    rmSync(projectDir, { recursive: true, force: true });
  });

  test("writes md, sidecar, topic file, and decision file", () => {
    const output = buildOutput();
    const result = splitConversation(output, {
      projectDir,
      cleanedMdSourcePath: cleanedSource,
    });

    expect(result.md_path).toBe(conversationMdPath(projectDir, "convo-1"));
    expect(result.sidecar_path).toBe(conversationJsonPath(projectDir, "convo-1"));
    expect(result.topic_paths).toEqual([topicJsonPath(projectDir, "topic-1")]);
    expect(result.decision_paths).toEqual([decisionJsonPath(projectDir, "dec-1")]);

    const sidecar = ConversationSidecarSchema.parse(
      JSON.parse(readFileSync(result.sidecar_path, "utf-8")),
    );
    expect(sidecar.conversation_id).toBe("convo-1");
    expect(sidecar.turns).toHaveLength(1);
    expect(sidecar.md_sha).toBe(computeContentSha(readFileSync(result.md_path)));

    const topic = TopicFileSchema.parse(
      JSON.parse(readFileSync(result.topic_paths[0], "utf-8")),
    );
    expect(topic.id).toBe("topic-1");
    expect(topic.parent_id).toBeNull();
    expect(topic.items).toHaveLength(1);
    const item = topic.items[0];
    expect(item.source_sha).toBeDefined();

    const decision = DecisionFileSchema.parse(
      JSON.parse(readFileSync(result.decision_paths[0], "utf-8")),
    );
    expect(decision.topic_id).toBe("topic-1");
    expect(decision.referenced_items[0].source_sha).toBeDefined();
  });

  test("skips writing topic files flagged edited_by_user", () => {
    const firstResult = splitConversation(buildOutput(), {
      projectDir,
      cleanedMdSourcePath: cleanedSource,
    });
    const topicPath = topicJsonPath(projectDir, "topic-1");
    const before = JSON.parse(readFileSync(topicPath, "utf-8"));
    before.title = "User Renamed";
    before.edited_by_user = true;
    writeFileSync(topicPath, JSON.stringify(before));

    const second = splitConversation(buildOutput(), {
      projectDir,
      cleanedMdSourcePath: firstResult.md_path,
    });
    expect(second.skipped_paths).toContain(topicPath);

    const after = TopicFileSchema.parse(
      JSON.parse(readFileSync(topicPath, "utf-8")),
    );
    expect(after.title).toBe("User Renamed");
    expect(after.edited_by_user).toBe(true);
  });

  test("merges items when re-splitting introduces a new ref", () => {
    const firstResult = splitConversation(buildOutput(), {
      projectDir,
      cleanedMdSourcePath: cleanedSource,
    });

    const second = buildOutput();
    second.conversation.topics[0].items.push({
      type: "idea_unit_ref",
      conversation_id: "convo-1",
      turn_index: 0,
      idea_unit_index: 1,
    });
    second.conversation.turns[0].idea_units.push({
      index: 1,
      sentences: ["Second unit."],
      categories: ["Information"],
    });
    splitConversation(second, {
      projectDir,
      cleanedMdSourcePath: firstResult.md_path,
    });

    const topic = TopicFileSchema.parse(
      JSON.parse(readFileSync(topicJsonPath(projectDir, "topic-1"), "utf-8")),
    );
    expect(topic.items).toHaveLength(2);
  });

  test("relocates the cleaned md when source path differs from canonical", () => {
    splitConversation(buildOutput(), {
      projectDir,
      cleanedMdSourcePath: cleanedSource,
    });
    expect(existsSync(cleanedSource)).toBe(false);
    expect(existsSync(conversationMdPath(projectDir, "convo-1"))).toBe(true);
  });
});
