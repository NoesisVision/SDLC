import "reflect-metadata";
import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  test,
} from "bun:test";
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "fs";
import { join } from "path";
import { and, given, then, when } from "@tests/bdd.js";
import {
  clearGraphNew,
  createKnowledgeNewTestModule,
  type KnowledgeNewTestContext,
} from "@tests/helpers/knowledge-new-test-context.js";
import {
  ConversationFileNewSchema,
  DecisionFileNewSchema,
  TopicFileNewSchema,
} from "@noesis/shared-contracts/source-file-schemas-new.js";
import {
  conversationJsonPath,
  decisionJsonPath,
  topicJsonPath,
} from "@noesis/shared-contracts/source-files.js";

interface SkillOutputBuilder {
  conversationId?: string;
  topicId?: string;
  decisionId?: string;
  decisionTitleLocked?: boolean;
  topicTitleLocked?: boolean;
  topicTitle?: string;
}

function makeSkillOutput(b: SkillOutputBuilder = {}): unknown {
  const conversationId = b.conversationId ?? "conv-1";
  const topicId = b.topicId ?? "topic-1";
  const decisionId = b.decisionId ?? "decision-1";
  return {
    conversation: {
      conversation_id: conversationId,
      time: "2026-04-17T10:00:00Z",
      main_topic: "Authentication strategy",
      turns: [
        {
          index: 0,
          speaker: "alice",
          time: "2026-04-17T10:00:00Z",
          idea_units: [
            {
              index: 0,
              sentences: ["We should use JWTs."],
              categories: ["Position"],
            },
            {
              index: 1,
              sentences: ["Stateless and standard."],
              categories: ["Argument"],
            },
          ],
        },
      ],
      topics: [
        {
          id: topicId,
          title: b.topicTitle ?? "JWT decision",
          short_summary: "Authentication choice.",
          long_summary: "We chose JWTs for stateless authentication.",
          items: [
            {
              type: "idea_unit_ref",
              conversation_id: conversationId,
              turn_index: 0,
              idea_unit_index: 0,
            },
          ],
          decisions: [
            {
              id: decisionId,
              title: "Adopt JWT",
              status: "accepted",
              referenced_items: [
                {
                  type: "idea_unit_ref",
                  conversation_id: conversationId,
                  turn_index: 0,
                  idea_unit_index: 0,
                },
              ],
              context: {
                text: "Need stateless auth.",
                supporting_item_indices: [0],
              },
              decision: {
                text: "Use JWT.",
                rationale: "Standard.",
                supporting_item_indices: [0],
              },
              alternative_options: [],
            },
          ],
          reviewed: true,
          decisions_extracted: true,
        },
      ],
    },
    potential_topics: {
      topics: [
        {
          id: topicId,
          title: b.topicTitle ?? "JWT decision",
          short_summary: "Authentication choice.",
          path: ["JWT decision"],
          is_new: true,
          parent_id: null,
        },
      ],
    },
  };
}

function writeWorkingDirFiles(
  workingDir: string,
  output: unknown,
  cleanedMd: string,
): { outputJsonPath: string; cleanedMdPath: string } {
  mkdirSync(workingDir, { recursive: true });
  const outputJsonPath = join(workingDir, "output.json");
  const cleanedMdPath = join(workingDir, "cleaned.md");
  writeFileSync(outputJsonPath, JSON.stringify(output, null, 2));
  writeFileSync(cleanedMdPath, cleanedMd);
  return { outputJsonPath, cleanedMdPath };
}

describe("ConversationsServiceNew — accept skill output, validate, split, save", () => {
  let ctx: KnowledgeNewTestContext;
  let workingDir: string;

  beforeAll(async () => {
    ctx = await createKnowledgeNewTestModule();
    workingDir = join(ctx.projectDir, "working");
  });

  afterAll(async () => {
    await ctx.module.close();
    rmSync(ctx.projectDir, { recursive: true, force: true });
  });

  beforeEach(async () => {
    await clearGraphNew(ctx.db);
    rmSync(workingDir, { recursive: true, force: true });
    rmSync(join(ctx.projectDir, "noesis"), { recursive: true, force: true });
  });

  test("merge writes the conversation, topics and decisions to canonical paths", async () => {
    let result: { conversation_id: string; topic_paths: string[]; decision_paths: string[] } | null = null;

    await given("an analyze-conversation working dir with valid output and cleaned md", () => {
      writeWorkingDirFiles(
        workingDir,
        makeSkillOutput(),
        "# Authentication\n\nalice: We should use JWTs.\n",
      );
    });
    await when("ConversationsServiceNew.merge is invoked with both paths", async () => {
      result = await ctx.conversations.merge({
        outputJsonPath: join(workingDir, "output.json"),
        cleanedMdPath: join(workingDir, "cleaned.md"),
      });
    });
    await then("the conversation json lands at noesis/conversations/<id>.json", () => {
      const path = conversationJsonPath(ctx.projectDir, "conv-1");
      const file = ConversationFileNewSchema.parse(
        JSON.parse(readFileSync(path, "utf-8")),
      );
      expect(file.conversation_id).toBe("conv-1");
      expect(file.turns).toHaveLength(1);
    });
    await and("the topic file lands at noesis/topics/<id>.json with parent_id null", () => {
      const tpath = topicJsonPath(ctx.projectDir, "topic-1");
      const topic = TopicFileNewSchema.parse(
        JSON.parse(readFileSync(tpath, "utf-8")),
      );
      expect(topic.parent_id).toBeNull();
      expect(topic.title_locked).toBe(false);
      expect(topic.items).toHaveLength(1);
      expect(topic.items[0].source_sha).toBeDefined();
    });
    await and("the decision file lands at noesis/decisions/<id>.json", () => {
      const dpath = decisionJsonPath(ctx.projectDir, "decision-1");
      const decision = DecisionFileNewSchema.parse(
        JSON.parse(readFileSync(dpath, "utf-8")),
      );
      expect(decision.title).toBe("Adopt JWT");
      expect(decision.referenced_items[0].source_sha).toBeDefined();
    });
    await and("the merge result reports the produced paths", () => {
      expect(result?.topic_paths).toHaveLength(1);
      expect(result?.decision_paths).toHaveLength(1);
    });
  });

  test("merge rejects unreviewed topics with a clear validation error", async () => {
    let thrown: Error | null = null;

    await given("a working dir whose topic has reviewed=false", () => {
      const output = makeSkillOutput() as { conversation: { topics: { reviewed: boolean }[] } };
      output.conversation.topics[0].reviewed = false;
      writeWorkingDirFiles(workingDir, output, "# any");
    });
    await when("merge is invoked", async () => {
      try {
        await ctx.conversations.merge({
          outputJsonPath: join(workingDir, "output.json"),
          cleanedMdPath: join(workingDir, "cleaned.md"),
        });
      } catch (e) {
        thrown = e as Error;
      }
    });
    await then("the service rejects the merge before writing any file", () => {
      expect(thrown?.message).toContain("reviewed");
    });
  });

  test("merge preserves locked topic title across re-runs of the skill", async () => {
    await given("a topic written by a prior merge then locked by the user", async () => {
      writeWorkingDirFiles(
        workingDir,
        makeSkillOutput(),
        "# any\n",
      );
      await ctx.conversations.merge({
        outputJsonPath: join(workingDir, "output.json"),
        cleanedMdPath: join(workingDir, "cleaned.md"),
      });
      await ctx.topics.editFields("topic-1", { title: "User-set title" }, false);
      // Lock the field directly on disk (UI would set this on save).
      const tpath = topicJsonPath(ctx.projectDir, "topic-1");
      const topic = TopicFileNewSchema.parse(
        JSON.parse(readFileSync(tpath, "utf-8")),
      );
      writeFileSync(
        tpath,
        JSON.stringify({ ...topic, title_locked: true }, null, 2),
      );
    });
    await when("the skill produces a new title and merge runs again", async () => {
      writeWorkingDirFiles(
        workingDir,
        makeSkillOutput({ topicTitle: "Skill-proposed title" }),
        "# any\n",
      );
      await ctx.conversations.merge({
        outputJsonPath: join(workingDir, "output.json"),
        cleanedMdPath: join(workingDir, "cleaned.md"),
      });
    });
    await then("the on-disk topic title is the user-set value, not the skill's", () => {
      const tpath = topicJsonPath(ctx.projectDir, "topic-1");
      const topic = TopicFileNewSchema.parse(
        JSON.parse(readFileSync(tpath, "utf-8")),
      );
      expect(topic.title).toBe("User-set title");
      expect(topic.title_locked).toBe(true);
    });
  });

  test("indexFile projects the conversation json into Conversation/Turn/IdeaUnit nodes", async () => {
    let path = "";

    await given("a merged conversation on disk", async () => {
      writeWorkingDirFiles(
        workingDir,
        makeSkillOutput(),
        "# any\n",
      );
      await ctx.conversations.merge({
        outputJsonPath: join(workingDir, "output.json"),
        cleanedMdPath: join(workingDir, "cleaned.md"),
      });
      path = conversationJsonPath(ctx.projectDir, "conv-1");
    });
    await when("the indexer projects the conversation file", async () => {
      const outcome = await ctx.conversations.indexFile(path);
      expect(outcome.status).toBe("indexed");
    });
    await then("the Conversation node carries the file's main_topic", async () => {
      const stored = await ctx.conversationsRepository.read("conv-1");
      expect(stored?.main_topic).toBe("Authentication strategy");
    });
  });
});
