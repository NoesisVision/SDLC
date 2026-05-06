import "reflect-metadata";
import {
  describe,
  test,
  beforeAll,
  afterAll,
  beforeEach,
  expect,
} from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "fs";
import { writeFile } from "fs/promises";
import { dirname, join } from "path";
import { tmpdir } from "os";
import { and, given, then, when } from "@tests/bdd.js";
import {
  clearGraph,
  countNodes,
  countRels,
  createKnowledgeTestModule,
  sampleConversation,
  type KnowledgeTestContext,
} from "@tests/helpers/knowledge-test-context.js";
import { conversationMdPath } from "@noesis/shared-contracts/source-files.js";
import { ConversationsService } from "@noesis/mcp/noesis-graph/knowledge/conversations/conversations.service.js";

describe("ConversationsService — recording, merging, and reviewing conversations", () => {
  let ctx: KnowledgeTestContext;
  let conversations: ConversationsService;

  beforeAll(async () => {
    ctx = await createKnowledgeTestModule();
    conversations = ctx.module.get(ConversationsService);
  });

  afterAll(async () => {
    await ctx.module.close();
    rmSync(ctx.tmpDir, { recursive: true, force: true });
  });

  beforeEach(async () => {
    await clearGraph(ctx.db);
  });

  test("loading a transcript from disk persists the full conversation tree", async () => {
    let path: string;
    let result: Awaited<
      ReturnType<ConversationsService["addConversationFromFile"]>
    >;

    await given("a transcript JSON file with two turns and three idea units", async () => {
      path = join(ctx.tmpDir, "conv.json");
      await writeFile(path, JSON.stringify(sampleConversation("conv-1")));
    });
    await when("the service ingests the file", async () => {
      result = await conversations.addConversationFromFile(path);
    });
    await then(
      "the summary reports the conversation id and the counted units",
      () => {
        expect(result).toEqual({
          conversation_id: "conv-1",
          turns: 2,
          idea_units: 3,
        });
      },
    );
    await and(
      "the conversation, turn, and idea-unit nodes are linked into the graph",
      async () => {
        expect(await countNodes(ctx.db, "Conversation")).toBe(1);
        expect(await countNodes(ctx.db, "Turn")).toBe(2);
        expect(await countNodes(ctx.db, "IdeaUnit")).toBe(3);
        expect(await countRels(ctx.db, "CONVERSATION_HAS_TURN")).toBe(2);
        expect(await countRels(ctx.db, "TURN_HAS_IDEA_UNIT")).toBe(3);
      },
    );
  });

  test("re-ingesting a conversation with the same id is rejected", async () => {
    let path: string;
    let thrown: Error | null = null;

    await given("a conversation that has already been recorded", async () => {
      path = join(ctx.tmpDir, "conv-dup.json");
      await writeFile(path, JSON.stringify(sampleConversation("conv-dup")));
      await conversations.addConversationFromFile(path);
    });
    await when(
      "the same transcript is offered for ingestion a second time",
      async () => {
        try {
          await conversations.addConversationFromFile(path);
        } catch (e) {
          thrown = e as Error;
        }
      },
    );
    await then(
      "the service refuses with an 'already exists' error to protect identity",
      () => {
        expect(thrown?.message).toMatch(/already exists/);
      },
    );
  });

  test("hasConversation flips from false to true when the transcript is ingested", async () => {
    let path: string;
    let beforeFlag: boolean;
    let afterFlag: boolean;

    await given(
      "an empty graph and a transcript file ready on disk",
      async () => {
        path = join(ctx.tmpDir, "conv.json");
        await writeFile(path, JSON.stringify(sampleConversation("conv-1")));
      },
    );
    await when("a caller queries presence, ingests the transcript, and queries again", async () => {
      beforeFlag = await conversations.hasConversation("conv-1");
      await conversations.addConversationFromFile(path);
      afterFlag = await conversations.hasConversation("conv-1");
    });
    await then("the flag is false before and true after the ingestion", () => {
      expect(beforeFlag).toBe(false);
      expect(afterFlag).toBe(true);
    });
  });

  test(
    "merging an analyze-conversation output upserts topics, links items, " +
      "and persists nested decisions",
    async () => {
      const workingDir = mkdtempSync(join(tmpdir(), "noesis-merge-"));
      let result: Awaited<
        ReturnType<ConversationsService["mergeConversation"]>
      >;

      try {
        await given(
          "a working directory with an output.json describing a new topic and decision",
          async () => {
            const conv = {
              conversation_id: "m1",
              time: "2026-04-17T10:00:00Z",
              main_topic: "Merge",
              turns: [
                {
                  index: 0,
                  speaker: "alice",
                  time: "2026-04-17T10:00:00Z",
                  idea_units: [
                    {
                      index: 0,
                      sentences: ["hello"],
                      categories: ["Information"],
                    },
                  ],
                },
              ],
              topics: [
                {
                  id: "m-topic-1",
                  title: "Merged Topic",
                  short_summary: "s",
                  long_summary: "l",
                  items: [
                    {
                      type: "idea_unit_ref",
                      conversation_id: "m1",
                      turn_index: 0,
                      idea_unit_index: 0,
                    },
                  ],
                  decisions: [
                    {
                      id: "m-dec-1",
                      title: "Pick A",
                      status: "accepted",
                      referenced_items: [],
                      context: { text: "", supporting_item_indices: [] },
                      decision: {
                        text: "",
                        rationale: "",
                        supporting_item_indices: [],
                      },
                      alternative_options: [],
                    },
                  ],
                  reviewed: true,
                  decisions_extracted: true,
                },
              ],
            };
            const output = {
              conversation: conv,
              potential_topics: {
                topics: [
                  {
                    id: "m-topic-1",
                    title: "Merged Topic",
                    short_summary: "s",
                    path: ["Merged Topic"],
                    is_new: true,
                    parent_id: null,
                  },
                ],
              },
            };
            await writeFile(
              join(workingDir, "output.json"),
              JSON.stringify(output),
            );
            const cleanedMd = conversationMdPath(ctx.tmpDir, "m1");
            mkdirSync(dirname(cleanedMd), { recursive: true });
            writeFileSync(cleanedMd, "<!-- conversation_id: m1 -->\n# T\n");
          },
        );
        await when("the service merges the output bundle", async () => {
          result = await conversations.mergeConversation(workingDir);
        });
        await then(
          "the report shows the topic added, no updates, one decision, and files written",
          () => {
            expect(result).toMatchObject({
              conversation_id: "m1",
              topics_added: 1,
              topics_updated: 0,
              decisions_added: 1,
            });
            expect(result.files_written).toBeGreaterThan(0);
          },
        );
        await and(
          "the graph contains the merged conversation, topic, decision, and links",
          async () => {
            expect(await countNodes(ctx.db, "Conversation")).toBe(1);
            expect(await countNodes(ctx.db, "Topic")).toBe(1);
            expect(await countNodes(ctx.db, "Decision")).toBe(1);
            expect(await countRels(ctx.db, "TOPIC_HAS_IDEA_UNIT")).toBe(1);
            expect(await countRels(ctx.db, "TOPIC_HAS_DECISION")).toBe(1);
          },
        );
      } finally {
        rmSync(workingDir, { recursive: true, force: true });
      }
    },
  );

  test(
    "preparing a review bundle emits topics in post-order so leaves come before parents",
    async () => {
      const workingDir = mkdtempSync(join(tmpdir(), "noesis-review-"));
      let bundle: Awaited<
        ReturnType<ConversationsService["prepareReviewBundle"]>
      >;

      try {
        await given(
          "an output describing one root topic with a single leaf child",
          async () => {
            const conv = {
              conversation_id: "post-1",
              time: "2026-04-17T10:00:00Z",
              main_topic: "PostOrder",
              turns: [
                {
                  index: 0,
                  speaker: "alice",
                  time: "2026-04-17T10:00:00Z",
                  idea_units: [
                    {
                      index: 0,
                      sentences: ["hello"],
                      categories: ["Information"],
                    },
                  ],
                },
              ],
              topics: [
                {
                  id: "root",
                  title: "Root",
                  short_summary: "",
                  long_summary: "",
                  items: [],
                  decisions: [],
                  reviewed: false,
                  decisions_extracted: false,
                },
                {
                  id: "leaf",
                  title: "Leaf",
                  short_summary: "",
                  long_summary: "",
                  items: [
                    {
                      type: "idea_unit_ref",
                      conversation_id: "post-1",
                      turn_index: 0,
                      idea_unit_index: 0,
                    },
                  ],
                  decisions: [],
                  reviewed: false,
                  decisions_extracted: false,
                },
              ],
            };
            const output = {
              conversation: conv,
              potential_topics: {
                topics: [
                  {
                    id: "root",
                    title: "Root",
                    short_summary: "",
                    path: ["Root"],
                    is_new: true,
                    parent_id: null,
                  },
                  {
                    id: "leaf",
                    title: "Leaf",
                    short_summary: "",
                    path: ["Root", "Leaf"],
                    is_new: true,
                    parent_id: "root",
                  },
                ],
              },
            };
            await writeFile(
              join(workingDir, "output.json"),
              JSON.stringify(output),
            );
          },
        );
        await when("the service builds the review markdown", async () => {
          bundle = await conversations.prepareReviewBundle(
            join(workingDir, "output.json"),
          );
        });
        await then("the bundle reports both topics with no prior idea units", () => {
          expect(bundle.topic_count).toBe(2);
          expect(bundle.topics_with_prior_units).toBe(0);
        });
        await and(
          "the leaf topic appears before the root topic in the rendered output",
          () => {
            const leafIdx = bundle.markdown.indexOf("topic_id: leaf");
            const rootIdx = bundle.markdown.indexOf("topic_id: root");
            expect(leafIdx).toBeGreaterThanOrEqual(0);
            expect(rootIdx).toBeGreaterThanOrEqual(0);
            expect(leafIdx).toBeLessThan(rootIdx);
          },
        );
        await and("sections are separated by horizontal rules", () => {
          expect(bundle.markdown).toContain("\n---\n");
        });
      } finally {
        rmSync(workingDir, { recursive: true, force: true });
      }
    },
  );

  test("validating an output file with a valid shape returns Ok", async () => {
    const workingDir = mkdtempSync(join(tmpdir(), "noesis-validate-"));
    let validation: Awaited<ReturnType<ConversationsService["validateOutput"]>>;

    try {
      await given(
        "a working directory with an output.json whose every idea unit is assigned to a topic",
        async () => {
          const output = {
            conversation: {
              conversation_id: "v1",
              time: "2026-04-17T10:00:00Z",
              main_topic: "V",
              turns: [
                {
                  index: 0,
                  speaker: "alice",
                  time: "2026-04-17T10:00:00Z",
                  idea_units: [
                    {
                      index: 0,
                      sentences: ["x"],
                      categories: ["Information"],
                    },
                  ],
                },
              ],
              topics: [
                {
                  id: "vt1",
                  title: "T",
                  short_summary: "",
                  long_summary: "",
                  items: [
                    {
                      type: "idea_unit_ref",
                      conversation_id: "v1",
                      turn_index: 0,
                      idea_unit_index: 0,
                    },
                  ],
                  decisions: [],
                  reviewed: false,
                  decisions_extracted: false,
                },
              ],
            },
            potential_topics: {
              topics: [
                {
                  id: "vt1",
                  title: "T",
                  short_summary: "",
                  path: ["T"],
                  is_new: true,
                  parent_id: null,
                },
              ],
            },
          };
          await writeFile(
            join(workingDir, "output.json"),
            JSON.stringify(output),
          );
        },
      );
      await when("the service validates the output", async () => {
        validation = await conversations.validateOutput(workingDir);
      });
      await then("the validation status is reported as Ok", () => {
        expect(validation.status).toBe("Ok");
      });
    } finally {
      rmSync(workingDir, { recursive: true, force: true });
    }
  });

  test("getConversationDetail surfaces the linked topics and decisions for a stored conversation", async () => {
    let detail: Awaited<
      ReturnType<ConversationsService["getConversationDetail"]>
    >;

    await given("a stored conversation with no extra topics or decisions", async () => {
      const path = join(ctx.tmpDir, "detail.json");
      await writeFile(path, JSON.stringify(sampleConversation("detail-1")));
      await conversations.addConversationFromFile(path);
    });
    await when("the consumer requests its detail view", async () => {
      detail = await conversations.getConversationDetail("detail-1");
    });
    await then("the view echoes the conversation's identity and metadata", () => {
      expect(detail.id).toBe("detail-1");
      expect(detail.title).toBe("Sample");
      expect(detail.date).toBe("2026-04-17T10:00:00Z");
    });
    await and("topic and decision lists are present and empty", () => {
      expect(detail.topics).toEqual([]);
      expect(detail.decisions).toEqual([]);
    });
  });

  test("getConversationDetail rejects requests for an unknown conversation", async () => {
    let thrown: Error | null = null;

    await given("an empty graph", () => {});
    await when("the consumer asks for a non-existent conversation's detail", async () => {
      try {
        await conversations.getConversationDetail("ghost");
      } catch (e) {
        thrown = e as Error;
      }
    });
    await then("the request fails with an explicit not-found error", () => {
      expect(thrown?.message).toMatch(/Conversation not found/);
    });
  });
});
