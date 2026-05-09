import "reflect-metadata";
import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  test,
} from "bun:test";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "fs";
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

describe("DecisionsServiceNew — indexing, editing with locks, referenced items, staleness", () => {
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

  test("Indexing a brand-new decision file inserts the corresponding Decision row in DB", async () => {
    let path = "";
    let outcome: { status: string; decision_id: string } | null = null;

    await given("a decision file present on disk and no record in DB", () => {
      path = writeDecisionOnDisk(ctx.projectDir, decisionFile());
    });
    await when("indexing the file", async () => {
      outcome = await ctx.decisions.indexFile(path);
    });
    await then("the operation reports the decision as freshly indexed", () => {
      expect(outcome?.status).toBe("indexed");
      expect(outcome?.decision_id).toBe("decision-1");
    });
    await and("the persisted Decision carries the file's title and status", async () => {
      const stored = await ctx.decisionsRepository.read("decision-1");
      expect(stored?.title).toBe("Use JWTs for sessions");
      expect(stored?.status).toBe("accepted");
      expect(stored?.is_stale).toBe(false);
    });
  });

  test("Indexing the same decision file twice without disk changes is a no-op", async () => {
    let path = "";
    let secondOutcome: { status: string } | null = null;

    await given("a decision indexed once", async () => {
      path = writeDecisionOnDisk(ctx.projectDir, decisionFile());
      await ctx.decisions.indexFile(path);
    });
    await when("indexing the file a second time without any disk changes", async () => {
      secondOutcome = await ctx.decisions.indexFile(path);
    });
    await then("the operation reports the decision as unchanged", () => {
      expect(secondOutcome?.status).toBe("unchanged");
    });
  });

  test("Indexing a decision whose file content drifted re-projects the changed fields into DB", async () => {
    let path = "";

    await given("a decision indexed once", async () => {
      path = writeDecisionOnDisk(ctx.projectDir, decisionFile());
      await ctx.decisions.indexFile(path);
    });
    await when("the file is rewritten with a new title and indexed again", async () => {
      writeDecisionOnDisk(
        ctx.projectDir,
        decisionFile({ title: "Adopt JWT for stateless sessions" }),
      );
      const outcome = await ctx.decisions.indexFile(path);
      expect(outcome.status).toBe("indexed");
    });
    await then("the persisted Decision reflects the new title", async () => {
      const stored = await ctx.decisionsRepository.read("decision-1");
      expect(stored?.title).toBe("Adopt JWT for stateless sessions");
    });
  });

  test("Editing a decision rewrites the title when it is unlocked and reports it as updated", async () => {
    let path = "";
    let result: { updated: string[] } | null = null;

    await given("a decision with an unlocked title", async () => {
      path = writeDecisionOnDisk(ctx.projectDir, decisionFile());
      await ctx.decisions.indexFile(path);
    });
    await when("the user changes the title", async () => {
      result = await ctx.decisions.editTopFieldsAndLock(
        "decision-1",
        { title: "Adopt JWT for stateless sessions" },
        false,
      );
    });
    await then("title is reported as updated", () => {
      expect(result?.updated).toEqual(["title"]);
    });
    await and("the new title is written to disk and its lock is now set", () => {
      const file = DecisionFileNewSchema.parse(
        JSON.parse(readFileSync(path, "utf-8")),
      );
      expect(file.title).toBe("Adopt JWT for stateless sessions");
      expect(file.title_locked).toBe(true);
    });
  });

  test("Editing a locked context text without user confirmation is refused", async () => {
    let path = "";
    let thrown: Error | null = null;

    await given("a decision whose context text is locked", async () => {
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
    await when("an edit tries to overwrite the locked context text without confirmation", async () => {
      try {
        await ctx.decisions.editTopFieldsAndLock(
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
    await and("the on-disk context text is unchanged", () => {
      const file = DecisionFileNewSchema.parse(
        JSON.parse(readFileSync(path, "utf-8")),
      );
      expect(file.context.text).toBe("Locked context");
    });
  });

  test("Editing a locked decision rationale with explicit user confirmation overwrites the value", async () => {
    let path = "";
    let result: { updated: string[] } | null = null;

    await given("a decision with a locked rationale", async () => {
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
    await when("the user confirms an override and supplies a new rationale", async () => {
      result = await ctx.decisions.editTopFieldsAndLock(
        "decision-1",
        { decision_rationale: "Updated rationale" },
        true,
      );
    });
    await then("the rationale is reported as updated", () => {
      expect(result?.updated).toEqual(["decision.rationale"]);
    });
    await and("the file's rationale carries the replacement value", () => {
      const file = DecisionFileNewSchema.parse(
        JSON.parse(readFileSync(path, "utf-8")),
      );
      expect(file.decision.rationale).toBe("Updated rationale");
    });
  });

  test("Editing a decision with a value identical to the stored one performs no write", async () => {
    let path = "";
    let snapshot = "";
    let result: { updated: string[] } | null = null;

    await given("a decision on disk with known content", async () => {
      path = writeDecisionOnDisk(ctx.projectDir, decisionFile());
      await ctx.decisions.indexFile(path);
      snapshot = readFileSync(path, "utf-8");
    });
    await when("the user submits a status equal to the current one", async () => {
      result = await ctx.decisions.editTopFieldsAndLock(
        "decision-1",
        { status: "accepted" },
        false,
      );
    });
    await then("no field is reported as updated", () => {
      expect(result?.updated).toEqual([]);
    });
    await and("the file content is byte-identical to the original snapshot", () => {
      expect(readFileSync(path, "utf-8")).toBe(snapshot);
    });
  });

  test("Editing an alternative option's text touches only the targeted alternative", async () => {
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
    await when("the user rewrites the second alternative's text", async () => {
      result = await ctx.decisions.editAlternativeOptionAndLock(
        "decision-1",
        { index: 1, text: "OAuth bearer tokens" },
        false,
      );
    });
    await then("only the targeted field is reported as updated", () => {
      expect(result?.updated).toEqual(["alternative_options[1].text"]);
    });
    await and("the first alternative is left untouched on disk and the edited alternative's text lock is now set", () => {
      const file = DecisionFileNewSchema.parse(
        JSON.parse(readFileSync(path, "utf-8")),
      );
      expect(file.alternative_options[0].text).toBe("Server sessions");
      expect(file.alternative_options[0].text_locked).toBe(false);
      expect(file.alternative_options[1].text).toBe("OAuth bearer tokens");
      expect(file.alternative_options[1].text_locked).toBe(true);
    });
  });

  test("Editing an alternative option at a non-existent index is rejected", async () => {
    let thrown: Error | null = null;

    await given("a decision indexed and on disk", async () => {
      const path = writeDecisionOnDisk(ctx.projectDir, decisionFile());
      await ctx.decisions.indexFile(path);
    });
    await when("the user supplies an alternative index that does not exist", async () => {
      try {
        await ctx.decisions.editAlternativeOptionAndLock(
          "decision-1",
          { index: 5, text: "anything" },
          false,
        );
      } catch (e) {
        thrown = e as Error;
      }
    });
    await then("the service refuses with an out-of-range error", () => {
      expect(thrown?.message).toContain("out of range");
    });
  });

  test("Appending referenced items adds new entries and de-duplicates by item key", async () => {
    let path = "";
    let result: { appended: number } | null = null;

    await given("a decision already referencing one document fragment", async () => {
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
    await when("the same fragment plus a new one are appended", async () => {
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
    await then("only the brand-new reference is counted as appended", () => {
      expect(result?.appended).toBe(1);
    });
    await and("the file ends up with both unique references", () => {
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

  test("Refreshing staleness marks a decision stale when a referenced source has drifted", async () => {
    let path = "";
    let staleCount = 0;

    await given("a decision referencing a document fragment with an outdated source sha", async () => {
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
    await when("staleness is refreshed against a snapshot with the document's new sha", async () => {
      staleCount = await ctx.decisions.refreshStaleFlags({
        conversation: new Map(),
        document: new Map([["doc-1", "new-sha"]]),
      });
    });
    await then("the operation reports one decision as stale", () => {
      expect(staleCount).toBe(1);
    });
    await and("both the DB row and the source file record the decision as stale", async () => {
      const stored = await ctx.decisionsRepository.read("decision-1");
      expect(stored?.is_stale).toBe(true);
      const file = DecisionFileNewSchema.parse(
        JSON.parse(readFileSync(path, "utf-8")),
      );
      expect(file.is_stale).toBe(true);
    });
  });

  test("Refreshing staleness clears the stale flag once a decision's sources are back in sync", async () => {
    let path = "";

    await given("a decision previously marked stale while referencing a document fragment", async () => {
      path = writeDecisionOnDisk(
        ctx.projectDir,
        decisionFile({
          is_stale: true,
          referenced_items: [
            {
              type: "document_fragment_ref",
              document_id: "doc-1",
              start_offset: 0,
              end_offset: 5,
              source_sha: "matching-sha",
            },
          ],
        }),
      );
      await ctx.decisions.indexFile(path);
    });
    await when("staleness is refreshed against a snapshot whose document sha matches the decision's", async () => {
      await ctx.decisions.refreshStaleFlags({
        conversation: new Map(),
        document: new Map([["doc-1", "matching-sha"]]),
      });
    });
    await then("the decision is no longer stale in DB or on disk", async () => {
      const stored = await ctx.decisionsRepository.read("decision-1");
      expect(stored?.is_stale).toBe(false);
      const file = DecisionFileNewSchema.parse(
        JSON.parse(readFileSync(path, "utf-8")),
      );
      expect(file.is_stale).toBe(false);
    });
  });

  test("Deleting a decision while its source file is still on disk removes both the DB row and the file", async () => {
    let path = "";

    await given("an indexed decision whose source file still lives on disk", async () => {
      path = writeDecisionOnDisk(ctx.projectDir, decisionFile());
      await ctx.decisions.indexFile(path);
    });
    await when("deletion is requested for the decision's canonical path", async () => {
      const result = await ctx.decisions.deleteForFile(path);
      expect(result?.decision_id).toBe("decision-1");
    });
    await then("the decision no longer exists in DB", async () => {
      expect(await ctx.decisionsRepository.exists("decision-1")).toBe(false);
    });
    await and("the source file is removed from disk", () => {
      expect(existsSync(path)).toBe(false);
    });
  });

  test("Deleting a decision whose source file is already gone still removes the DB row", async () => {
    let path = "";

    await given("an indexed decision whose source file has been removed from disk", async () => {
      path = writeDecisionOnDisk(ctx.projectDir, decisionFile());
      await ctx.decisions.indexFile(path);
      rmSync(path, { force: true });
    });
    await when("deletion is requested for the decision's canonical path", async () => {
      const result = await ctx.decisions.deleteForFile(path);
      expect(result?.decision_id).toBe("decision-1");
    });
    await then("the decision no longer exists in DB", async () => {
      expect(await ctx.decisionsRepository.exists("decision-1")).toBe(false);
    });
  });
});

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
