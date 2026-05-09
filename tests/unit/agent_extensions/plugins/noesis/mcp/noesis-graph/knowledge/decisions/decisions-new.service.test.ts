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
  DecisionFileNewSchema,
  type DecisionFileNew,
} from "@noesis/shared-contracts/source-file-schemas-new.js";
import { decisionJsonPath } from "@noesis/shared-contracts/source-files.js";

function decisionFile(overrides: Partial<DecisionFileNew> = {}): DecisionFileNew {
  return DecisionFileNewSchema.parse({
    id: "decision-1",
    topic_id: "topic-1",
    title: "Use JWTs for sessions",
    status: "accepted",
    referenced_items: [],
    context: {
      text: "We need stateless sessions.",
      supporting_item_indices: [],
    },
    decision: {
      text: "Use JWT tokens.",
      rationale: "Avoid server-side session storage.",
      supporting_item_indices: [],
    },
    alternative_options: [
      {
        text: "Server sessions",
        rationale: "Familiar but stateful.",
        supporting_item_indices: [],
      },
    ],
    is_stale: false,
    ...overrides,
  });
}

function writeDecisionOnDisk(projectDir: string, file: DecisionFileNew): string {
  const path = decisionJsonPath(projectDir, file.id);
  mkdirSync(join(projectDir, "noesis", "decisions"), { recursive: true });
  writeFileSync(path, JSON.stringify(file, null, 2));
  return path;
}

describe("DecisionsServiceNew — index, edit with locks, append referenced items, stale", () => {
  let ctx: KnowledgeNewTestContext;

  beforeAll(async () => {
    ctx = await createKnowledgeNewTestModule();
  });

  afterAll(async () => {
    await ctx.module.close();
    rmSync(ctx.projectDir, { recursive: true, force: true });
  });

  beforeEach(async () => {
    await clearGraphNew(ctx.db);
  });

  test("indexFile inserts a Decision row when no DB record exists", async () => {
    let path = "";
    let outcome: { status: string; decision_id: string } | null = null;

    await given("a decision file present on disk", () => {
      path = writeDecisionOnDisk(ctx.projectDir, decisionFile());
    });
    await when("the indexer processes the file", async () => {
      outcome = await ctx.decisions.indexFile(path);
    });
    await then("the service reports it indexed the file", () => {
      expect(outcome?.status).toBe("indexed");
      expect(outcome?.decision_id).toBe("decision-1");
    });
    await and("the Decision node carries the file's title and status", async () => {
      const stored = await ctx.decisionsRepository.read("decision-1");
      expect(stored?.title).toBe("Use JWTs for sessions");
      expect(stored?.status).toBe("accepted");
      expect(stored?.is_stale).toBe(false);
    });
  });

  test("indexFile is unchanged on a second pass with no disk modifications", async () => {
    let path = "";
    let secondOutcome: { status: string } | null = null;

    await given("a decision indexed once", async () => {
      path = writeDecisionOnDisk(ctx.projectDir, decisionFile());
      await ctx.decisions.indexFile(path);
    });
    await when("the indexer runs again on the same file", async () => {
      secondOutcome = await ctx.decisions.indexFile(path);
    });
    await then("the service reports the file as unchanged", () => {
      expect(secondOutcome?.status).toBe("unchanged");
    });
  });

  test("editTopFields rewrites the title when not locked and reports the change", async () => {
    let path = "";
    let result: { updated: string[] } | null = null;

    await given("a decision with an unlocked title", async () => {
      path = writeDecisionOnDisk(ctx.projectDir, decisionFile());
      await ctx.decisions.indexFile(path);
    });
    await when("the user edits the title", async () => {
      result = await ctx.decisions.editTopFields(
        "decision-1",
        { title: "Adopt JWT for stateless sessions" },
        false,
      );
    });
    await then("the service reports title as updated", () => {
      expect(result?.updated).toEqual(["title"]);
    });
    await and("the on-disk title is rewritten", () => {
      const file = DecisionFileNewSchema.parse(
        JSON.parse(readFileSync(path, "utf-8")),
      );
      expect(file.title).toBe("Adopt JWT for stateless sessions");
    });
  });

  test("editTopFields refuses to overwrite a locked context.text without confirmation", async () => {
    let path = "";
    let thrown: Error | null = null;

    await given("a decision whose context.text is locked", async () => {
      path = writeDecisionOnDisk(
        ctx.projectDir,
        decisionFile({
          context: {
            text: "Locked context",
            text_locked: true,
            supporting_item_indices: [],
          },
        }),
      );
      await ctx.decisions.indexFile(path);
    });
    await when("an unconfirmed edit tries to rewrite context.text", async () => {
      try {
        await ctx.decisions.editTopFields(
          "decision-1",
          { context_text: "Different context" },
          false,
        );
      } catch (e) {
        thrown = e as Error;
      }
    });
    await then("the service refuses with a lock violation", () => {
      expect(thrown?.message).toContain("locked");
    });
    await and("the on-disk context.text is unchanged", () => {
      const file = DecisionFileNewSchema.parse(
        JSON.parse(readFileSync(path, "utf-8")),
      );
      expect(file.context.text).toBe("Locked context");
    });
  });

  test("editTopFields overrides a locked decision.rationale when confirmedByUser is true", async () => {
    let path = "";
    let result: { updated: string[] } | null = null;

    await given("a decision with a locked decision.rationale", async () => {
      path = writeDecisionOnDisk(
        ctx.projectDir,
        decisionFile({
          decision: {
            text: "Use JWT",
            rationale: "Original rationale",
            rationale_locked: true,
            supporting_item_indices: [],
          },
        }),
      );
      await ctx.decisions.indexFile(path);
    });
    await when("the user confirms an override of the rationale", async () => {
      result = await ctx.decisions.editTopFields(
        "decision-1",
        { decision_rationale: "Updated rationale" },
        true,
      );
    });
    await then("decision.rationale is reported as updated", () => {
      expect(result?.updated).toEqual(["decision.rationale"]);
    });
    await and("the on-disk rationale reflects the new value", () => {
      const file = DecisionFileNewSchema.parse(
        JSON.parse(readFileSync(path, "utf-8")),
      );
      expect(file.decision.rationale).toBe("Updated rationale");
    });
  });

  test("editTopFields skips the write when the new value equals the current value", async () => {
    let path = "";
    let snapshot = "";
    let result: { updated: string[] } | null = null;

    await given("a decision on disk with known content", async () => {
      path = writeDecisionOnDisk(ctx.projectDir, decisionFile());
      await ctx.decisions.indexFile(path);
      snapshot = readFileSync(path, "utf-8");
    });
    await when("the user submits the same status as already stored", async () => {
      result = await ctx.decisions.editTopFields(
        "decision-1",
        { status: "accepted" },
        false,
      );
    });
    await then("nothing is reported as updated", () => {
      expect(result?.updated).toEqual([]);
    });
    await and("the file content is byte-identical", () => {
      expect(readFileSync(path, "utf-8")).toBe(snapshot);
    });
  });

  test("editAlternativeOption edits text on the requested alternative only", async () => {
    let path = "";
    let result: { updated: string[] } | null = null;

    await given("a decision with two alternatives", async () => {
      path = writeDecisionOnDisk(
        ctx.projectDir,
        decisionFile({
          alternative_options: [
            {
              text: "Server sessions",
              rationale: "Stateful.",
              supporting_item_indices: [],
            },
            {
              text: "OAuth tokens",
              rationale: "Delegated.",
              supporting_item_indices: [],
            },
          ],
        }),
      );
      await ctx.decisions.indexFile(path);
    });
    await when("the user edits alternative #1's text", async () => {
      result = await ctx.decisions.editAlternativeOption(
        "decision-1",
        { index: 1, text: "OAuth bearer tokens" },
        false,
      );
    });
    await then("only that field is reported as updated", () => {
      expect(result?.updated).toEqual(["alternative_options[1].text"]);
    });
    await and("the first alternative is untouched on disk", () => {
      const file = DecisionFileNewSchema.parse(
        JSON.parse(readFileSync(path, "utf-8")),
      );
      expect(file.alternative_options[0].text).toBe("Server sessions");
      expect(file.alternative_options[1].text).toBe("OAuth bearer tokens");
    });
  });

  test("editAlternativeOption rejects out-of-range index", async () => {
    let thrown: Error | null = null;

    await given("a decision indexed and on disk", async () => {
      const path = writeDecisionOnDisk(ctx.projectDir, decisionFile());
      await ctx.decisions.indexFile(path);
    });
    await when("the user passes an alternative index that does not exist", async () => {
      try {
        await ctx.decisions.editAlternativeOption(
          "decision-1",
          { index: 5, text: "anything" },
          false,
        );
      } catch (e) {
        thrown = e as Error;
      }
    });
    await then("the service rejects with an out-of-range error", () => {
      expect(thrown?.message).toContain("out of range");
    });
  });

  test("appendReferencedItems adds new entries and de-duplicates by item key", async () => {
    let path = "";
    let result: { appended: number } | null = null;

    await given("a decision with one referenced fragment", async () => {
      path = writeDecisionOnDisk(
        ctx.projectDir,
        decisionFile({
          referenced_items: [
            {
              type: "document_fragment_ref",
              document_id: "doc-1",
              start_offset: 0,
              end_offset: 5,
            },
          ],
        }),
      );
      await ctx.decisions.indexFile(path);
    });
    await when("a duplicate plus a new ref are appended", async () => {
      result = await ctx.decisions.appendReferencedItems("decision-1", [
        {
          type: "document_fragment_ref",
          document_id: "doc-1",
          start_offset: 0,
          end_offset: 5,
        },
        {
          type: "document_fragment_ref",
          document_id: "doc-1",
          start_offset: 6,
          end_offset: 12,
        },
      ]);
    });
    await then("only the new ref is reported as appended", () => {
      expect(result?.appended).toBe(1);
    });
    await and("the file contains both unique refs", () => {
      const file = DecisionFileNewSchema.parse(
        JSON.parse(readFileSync(path, "utf-8")),
      );
      expect(file.referenced_items).toHaveLength(2);
      expect(file.referenced_items[1]).toMatchObject({
        document_id: "doc-1",
        start_offset: 6,
        end_offset: 12,
      });
    });
  });

  test("refreshStaleFlags marks decision stale when a referenced fragment's source_sha is outdated", async () => {
    let path = "";
    let staleCount = 0;

    await given("a decision referencing a doc fragment with a known source_sha", async () => {
      path = writeDecisionOnDisk(
        ctx.projectDir,
        decisionFile({
          referenced_items: [
            {
              type: "document_fragment_ref",
              document_id: "doc-1",
              start_offset: 0,
              end_offset: 5,
              source_sha: "old-sha",
            },
          ],
        }),
      );
      await ctx.decisions.indexFile(path);
    });
    await when("the staleness pass runs with a newer document sha", async () => {
      staleCount = await ctx.decisions.refreshStaleFlags({
        conversation: new Map(),
        document: new Map([["doc-1", "new-sha"]]),
      });
    });
    await then("the staleness count is one", () => {
      expect(staleCount).toBe(1);
    });
    await and("DB and the file both record is_stale=true", async () => {
      const stored = await ctx.decisionsRepository.read("decision-1");
      expect(stored?.is_stale).toBe(true);
      const file = DecisionFileNewSchema.parse(
        JSON.parse(readFileSync(path, "utf-8")),
      );
      expect(file.is_stale).toBe(true);
    });
  });

  test("deleteForFile removes the Decision row when given the canonical file path", async () => {
    let path = "";

    await given("an indexed decision", async () => {
      path = writeDecisionOnDisk(ctx.projectDir, decisionFile());
      await ctx.decisions.indexFile(path);
    });
    await when("deleteForFile is invoked", async () => {
      const result = await ctx.decisions.deleteForFile(path);
      expect(result?.decision_id).toBe("decision-1");
    });
    await then("the Decision no longer exists in DB", async () => {
      expect(await ctx.decisionsRepository.exists("decision-1")).toBe(false);
    });
  });
});
