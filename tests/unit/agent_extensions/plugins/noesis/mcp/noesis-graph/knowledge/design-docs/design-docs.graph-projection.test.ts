import "reflect-metadata";
import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  test,
} from "bun:test";
import { mkdirSync, writeFileSync } from "fs";
import { join } from "path";
import { and, given, then, when } from "@tests/bdd.js";
import {
  clearGraphNew,
  createKnowledgeNewTestModule,
  type KnowledgeNewTestContext,
} from "@tests/helpers/knowledge-test-context.js";
import {
  DesignDocFileNewSchema,
  type DesignDocFileNew,
} from "@noesis/shared-contracts/design-doc-new.js";
import { designDocCanonicalPath } from "@noesis/shared-contracts/source-files.js";

describe("DesignDocsService — graph projection of the on-disk sidecar", () => {
  let ctx: KnowledgeNewTestContext;

  beforeAll(async () => {
    ctx = await createKnowledgeNewTestModule();
  });

  afterAll(async () => {
    await ctx.module.close();
  });

  beforeEach(async () => {
    await clearGraphNew(ctx.db);
  });

  test("Indexing a doc with added + modified bounded contexts creates one node per entry, linked by slot-specific edges", async () => {
    await given(
      "a design doc with one added bounded context 'Catalog' and one modified bounded context 'Sales'",
      async () => {
        await indexDesignDoc(
          ctx,
          buildDesignDoc({
            id: "dd-bc",
            boundedContexts: {
              added: [bc("Catalog", "new context")],
              modified: [bc("Sales", "tweaked context")],
              removed: ["Reporting"],
            },
          }),
        );
      },
    );

    let bcs: Array<{ id: string; name: string; description: string }> = [];
    await when("listing the bounded-context nodes in the graph", async () => {
      bcs = await ctx.db.query(
        "MATCH (b:DesignedBoundedContext) WHERE b.design_doc_id = $id " +
          "RETURN b.id AS id, b.name AS name, b.description AS description ORDER BY b.name",
        { id: "dd-bc" },
      );
    });
    await then(
      "two bounded-context nodes exist, one per change-set entry",
      () => {
        expect(bcs.map((r) => r.name)).toEqual(["Catalog", "Sales"]);
      },
    );

    let addedEdges: Array<{ name: string }> = [];
    let modifiedEdges: Array<{ name: string }> = [];
    await when("looking at the per-slot edges from the design doc", async () => {
      addedEdges = await ctx.db.query(
        "MATCH (d:DesignDoc)-[:DESIGNDOC_HAS_ADDED_BOUNDED_CONTEXT]->(b:DesignedBoundedContext) " +
          "WHERE d.id = $id RETURN b.name AS name",
        { id: "dd-bc" },
      );
      modifiedEdges = await ctx.db.query(
        "MATCH (d:DesignDoc)-[:DESIGNDOC_HAS_MODIFIED_BOUNDED_CONTEXT]->(b:DesignedBoundedContext) " +
          "WHERE d.id = $id RETURN b.name AS name",
        { id: "dd-bc" },
      );
    });
    await then(
      "the HAS_ADDED edge points to 'Catalog' and HAS_MODIFIED edge points to 'Sales'",
      () => {
        expect(addedEdges.map((r) => r.name)).toEqual(["Catalog"]);
        expect(modifiedEdges.map((r) => r.name)).toEqual(["Sales"]);
      },
    );

    let removedNames: Array<{ removed: string[] }> = [];
    await when("reading the doc's removed_bounded_context_names list", async () => {
      removedNames = await ctx.db.query(
        "MATCH (d:DesignDoc) WHERE d.id = $id RETURN d.removed_bounded_context_names AS removed",
        { id: "dd-bc" },
      );
    });
    await then(
      "the removed-name list captures the 'Reporting' bounded context as a scalar",
      () => {
        expect(removedNames[0]?.removed).toEqual(["Reporting"]);
      },
    );
  });

  test("Indexing a doc with the full nested hierarchy projects every level into the graph", async () => {
    await given("a design doc covering BC → Module → BuildingBlock → Behaviour → Rule/Scenario/QA", async () => {
      await indexDesignDoc(ctx, deeplyNestedDoc("dd-full"));
    });

    let nodes: Record<string, number> = {};
    await when(
      "counting nodes per label owned by this design doc",
      async () => {
        nodes = await countOwnedNodes(ctx, "dd-full");
      },
    );
    await then(
      "every nested entity becomes its own node — modules, building blocks, behaviours, properties, rules, scenarios, quality attributes",
      () => {
        expect(nodes).toMatchObject({
          DesignedBoundedContext: 1,
          DesignedDomainModule: 1,
          DesignedBuildingBlock: 1,
          DesignedBehaviour: 1,
          DesignedProperty: 1,
          DesignedRule: 2,
          DesignedScenario: 2,
          DesignedQualityAttribute: 1,
        });
      },
    );

    let behaviourRow: Array<{
      input_added: string[];
      output_modified: string[];
      ubb_removed: string[];
      actor: string;
    }> = [];
    await when(
      "reading the behaviour's stringly-typed reference change-sets",
      async () => {
        behaviourRow = await ctx.db.query(
          "MATCH (b:DesignedBehaviour) WHERE b.design_doc_id = $id RETURN " +
            "b.input_added AS input_added, " +
            "b.output_modified AS output_modified, " +
            "b.used_building_blocks_removed AS ubb_removed, " +
            "b.actor AS actor",
          { id: "dd-full" },
        );
      },
    );
    await then(
      "the BuildingBlock reference change-sets round-trip as scalar STRING[] lists per slot",
      () => {
        expect(behaviourRow[0]).toEqual({
          input_added: ["Cart"],
          output_modified: ["LineBreakdown"],
          ubb_removed: ["LegacyHelper"],
          actor: "Customer",
        });
      },
    );

    let actorEdge: Array<{ name: string }> = [];
    await when(
      "looking for the BEHAVIOUR_PERFORMED_BY_ACTOR edge",
      async () => {
        actorEdge = await ctx.db.query(
          "MATCH (b:DesignedBehaviour)-[:BEHAVIOUR_PERFORMED_BY_ACTOR]->(a:Actor) " +
            "WHERE b.design_doc_id = $id RETURN a.name AS name",
          { id: "dd-full" },
        );
      },
    );
    await then(
      "the behaviour is linked to the declared 'Customer' actor as a graph edge",
      () => {
        expect(actorEdge.map((r) => r.name)).toEqual(["Customer"]);
      },
    );
  });

  test("A building block reachable via Module is connected by DOMAIN_MODULE_* edges, not BOUNDED_CONTEXT_*", async () => {
    await given(
      "a doc whose BC owns a module that in turn owns the building block",
      async () => {
        await indexDesignDoc(ctx, deeplyNestedDoc("dd-edges"));
      },
    );

    let viaModule: Array<{ name: string }> = [];
    let viaBc: Array<{ name: string }> = [];
    await when("walking each owning path", async () => {
      viaModule = await ctx.db.query(
        "MATCH (m:DesignedDomainModule)-[:DOMAIN_MODULE_HAS_ADDED_BUILDING_BLOCK]->(b:DesignedBuildingBlock) " +
          "WHERE m.design_doc_id = $id RETURN b.name AS name",
        { id: "dd-edges" },
      );
      viaBc = await ctx.db.query(
        "MATCH (c:DesignedBoundedContext)-[:BOUNDED_CONTEXT_HAS_ADDED_BUILDING_BLOCK]->(b:DesignedBuildingBlock) " +
          "WHERE c.design_doc_id = $id RETURN b.name AS name",
        { id: "dd-edges" },
      );
    });
    await then(
      "the building block is reachable through the module's edge, not the BC's edge",
      () => {
        expect(viaModule.map((r) => r.name)).toEqual(["PriceCalculator"]);
        expect(viaBc).toHaveLength(0);
      },
    );
  });

  test("Re-indexing a doc with a different shape replaces its owned subgraph rather than accumulating nodes", async () => {
    await given("a doc indexed with one bounded context 'Auth'", async () => {
      await indexDesignDoc(
        ctx,
        buildDesignDoc({
          id: "dd-rep",
          boundedContexts: {
            added: [bc("Auth", "first shape")],
            modified: [],
            removed: [],
          },
        }),
      );
    });
    await when(
      "re-indexing the same doc with a different bounded context 'Billing'",
      async () => {
        await indexDesignDoc(
          ctx,
          buildDesignDoc({
            id: "dd-rep",
            boundedContexts: {
              added: [bc("Billing", "second shape")],
              modified: [],
              removed: [],
            },
          }),
        );
      },
    );
    let names: Array<{ name: string }> = [];
    await then("only the new bounded context remains", async () => {
      names = await ctx.db.query(
        "MATCH (b:DesignedBoundedContext) WHERE b.design_doc_id = $id RETURN b.name AS name",
        { id: "dd-rep" },
      );
      expect(names.map((r) => r.name)).toEqual(["Billing"]);
    });
  });

  test("Deleting a design doc detaches and removes every owned nested node", async () => {
    await given("a deeply nested doc with full hierarchy projected to the graph", async () => {
      await indexDesignDoc(ctx, deeplyNestedDoc("dd-del"));
    });
    await when("the design doc is deleted by id", async () => {
      await ctx.designDocsRepository.delete("dd-del");
    });
    let nodes: Record<string, number> = {};
    await then("no nested nodes remain in any label for that doc", async () => {
      nodes = await countOwnedNodes(ctx, "dd-del");
      const total = Object.values(nodes).reduce((sum, n) => sum + n, 0);
      expect(total).toBe(0);
    });
    await and("the DesignDoc node itself is gone", async () => {
      const rows = await ctx.db.query<{ id: string }>(
        "MATCH (d:DesignDoc) WHERE d.id = $id RETURN d.id AS id",
        { id: "dd-del" },
      );
      expect(rows).toHaveLength(0);
    });
  });

  test("ChangeSet `removed` lists ride along as scalar name fields on the parent node", async () => {
    await given("a doc whose nested change-sets carry `removed` entries at every level", async () => {
      await indexDesignDoc(ctx, deeplyNestedDoc("dd-rm"));
    });
    let bcRow: Array<{
      removed_module_names: string[];
      removed_building_block_names: string[];
      removed_quality_attribute_names: string[];
    }> = [];
    let moduleRow: Array<{
      removed_building_block_names: string[];
      removed_quality_attribute_names: string[];
    }> = [];
    let bbRow: Array<{
      removed_behaviour_names: string[];
      removed_property_names: string[];
      removed_rule_names: string[];
      removed_scenario_names: string[];
      removed_quality_attribute_names: string[];
    }> = [];
    let bhRow: Array<{
      removed_rule_names: string[];
      removed_scenario_names: string[];
      removed_quality_attribute_names: string[];
    }> = [];

    await when("reading every parent's removed-names lists", async () => {
      bcRow = await ctx.db.query(
        "MATCH (b:DesignedBoundedContext) WHERE b.design_doc_id = $id RETURN " +
          "b.removed_module_names AS removed_module_names, " +
          "b.removed_building_block_names AS removed_building_block_names, " +
          "b.removed_quality_attribute_names AS removed_quality_attribute_names",
        { id: "dd-rm" },
      );
      moduleRow = await ctx.db.query(
        "MATCH (m:DesignedDomainModule) WHERE m.design_doc_id = $id RETURN " +
          "m.removed_building_block_names AS removed_building_block_names, " +
          "m.removed_quality_attribute_names AS removed_quality_attribute_names",
        { id: "dd-rm" },
      );
      bbRow = await ctx.db.query(
        "MATCH (b:DesignedBuildingBlock) WHERE b.design_doc_id = $id RETURN " +
          "b.removed_behaviour_names AS removed_behaviour_names, " +
          "b.removed_property_names AS removed_property_names, " +
          "b.removed_rule_names AS removed_rule_names, " +
          "b.removed_scenario_names AS removed_scenario_names, " +
          "b.removed_quality_attribute_names AS removed_quality_attribute_names",
        { id: "dd-rm" },
      );
      bhRow = await ctx.db.query(
        "MATCH (b:DesignedBehaviour) WHERE b.design_doc_id = $id RETURN " +
          "b.removed_rule_names AS removed_rule_names, " +
          "b.removed_scenario_names AS removed_scenario_names, " +
          "b.removed_quality_attribute_names AS removed_quality_attribute_names",
        { id: "dd-rm" },
      );
    });
    await then("each removed-name list matches the source ChangeSet `removed` slot", () => {
      expect(bcRow[0]).toEqual({
        removed_module_names: ["LegacyModule"],
        removed_building_block_names: ["LegacyBuildingBlock"],
        removed_quality_attribute_names: ["LegacyBcQA"],
      });
      expect(moduleRow[0]).toEqual({
        removed_building_block_names: ["LegacyModuleBuildingBlock"],
        removed_quality_attribute_names: ["LegacyModuleQA"],
      });
      expect(bbRow[0]).toEqual({
        removed_behaviour_names: ["legacyBehaviour"],
        removed_property_names: ["legacyProperty"],
        removed_rule_names: ["legacyBbRule"],
        removed_scenario_names: ["legacyBbScenario"],
        removed_quality_attribute_names: ["legacyBbQa"],
      });
      expect(bhRow[0]).toEqual({
        removed_rule_names: ["legacyBhRule"],
        removed_scenario_names: ["legacyBhScenario"],
        removed_quality_attribute_names: ["legacyBhQa"],
      });
    });
  });
});

function buildDesignDoc(overrides: Partial<DesignDocFileNew>): DesignDocFileNew {
  return DesignDocFileNewSchema.parse({
    id: "dd-default",
    name: "Doc",
    name_locked: false,
    description: "",
    description_locked: false,
    actors: [],
    boundedContexts: { added: [], modified: [], removed: [] },
    implemented: false,
    ...overrides,
  });
}

function bc(name: string, description: string) {
  return {
    name,
    name_locked: false,
    description,
    description_locked: false,
  };
}

function deeplyNestedDoc(id: string): DesignDocFileNew {
  return DesignDocFileNewSchema.parse({
    id,
    name: "Nested",
    name_locked: false,
    description: "Covers every nested level.",
    description_locked: false,
    actors: [
      {
        name: "Customer",
        name_locked: false,
        description: "End user.",
        description_locked: false,
      },
    ],
    boundedContexts: {
      added: [
        {
          name: "Sales",
          name_locked: false,
          description: "Order capture.",
          description_locked: false,
          modules: {
            added: [
              {
                name: "Pricing",
                name_locked: false,
                description: "Pricing rules.",
                description_locked: false,
                buildingBlocks: {
                  added: [
                    {
                      name: "PriceCalculator",
                      name_locked: false,
                      type: "domain_service",
                      type_locked: false,
                      description: "Computes totals.",
                      description_locked: false,
                      implements: ["IPricingPort"],
                      properties: {
                        added: [
                          {
                            name: "currentTier",
                            name_locked: false,
                            type: "TierLevel",
                            type_locked: false,
                            description: "Active tier.",
                            description_locked: false,
                            nullable: false,
                            collection: false,
                          },
                        ],
                        modified: [],
                        removed: ["legacyProperty"],
                      },
                      behaviours: {
                        added: [
                          {
                            name: "calculate",
                            name_locked: false,
                            description: "Computes the totals.",
                            description_locked: false,
                            type: "Command",
                            type_locked: false,
                            input: {
                              added: ["Cart"],
                              modified: [],
                              removed: [],
                            },
                            output: {
                              added: [],
                              modified: ["LineBreakdown"],
                              removed: [],
                            },
                            usedBuildingBlocks: {
                              added: [],
                              modified: [],
                              removed: ["LegacyHelper"],
                            },
                            rules: {
                              added: [
                                {
                                  name: "round-half-up",
                                  name_locked: false,
                                  ruleType: "Computation",
                                  description: "Round half up.",
                                  description_locked: false,
                                },
                              ],
                              modified: [],
                              removed: ["legacyBhRule"],
                            },
                            scenarios: {
                              added: [
                                {
                                  name: "happy path",
                                  name_locked: false,
                                  description: "Computes the total.",
                                  description_locked: false,
                                  given: "a cart with one item",
                                  given_locked: false,
                                  when: "calculate is invoked",
                                  when_locked: false,
                                  then: "totals reflect the single item",
                                  then_locked: false,
                                },
                              ],
                              modified: [],
                              removed: ["legacyBhScenario"],
                            },
                            qualityAttributes: {
                              added: [
                                {
                                  name: "p99-latency",
                                  name_locked: false,
                                  type: "performance",
                                  description: "p99 under 100ms.",
                                  description_locked: false,
                                },
                              ],
                              modified: [],
                              removed: ["legacyBhQa"],
                            },
                            isPublic: true,
                            actor: "Customer",
                            actor_locked: false,
                          },
                        ],
                        modified: [],
                        removed: ["legacyBehaviour"],
                      },
                      rules: {
                        added: [
                          {
                            name: "tier-applied-once",
                            name_locked: false,
                            ruleType: "Computation",
                            description: "Apply the tier once per pass.",
                            description_locked: false,
                          },
                        ],
                        modified: [],
                        removed: ["legacyBbRule"],
                      },
                      scenarios: {
                        added: [
                          {
                            name: "ignores expired discount",
                            name_locked: false,
                            description: "Expired discount is skipped.",
                            description_locked: false,
                            given: "a cart with an expired discount",
                            given_locked: false,
                            when: "calculate is invoked",
                            when_locked: false,
                            then: "the expired discount is ignored",
                            then_locked: false,
                          },
                        ],
                        modified: [],
                        removed: ["legacyBbScenario"],
                      },
                      qualityAttributes: {
                        added: [],
                        modified: [],
                        removed: ["legacyBbQa"],
                      },
                    },
                  ],
                  modified: [],
                  removed: ["LegacyModuleBuildingBlock"],
                },
                qualityAttributes: {
                  added: [],
                  modified: [],
                  removed: ["LegacyModuleQA"],
                },
              },
            ],
            modified: [],
            removed: ["LegacyModule"],
          },
          buildingBlocks: {
            added: [],
            modified: [],
            removed: ["LegacyBuildingBlock"],
          },
          qualityAttributes: {
            added: [],
            modified: [],
            removed: ["LegacyBcQA"],
          },
        },
      ],
      modified: [],
      removed: [],
    },
    implemented: false,
  });
}

async function indexDesignDoc(
  ctx: KnowledgeNewTestContext,
  file: DesignDocFileNew,
): Promise<void> {
  const path = designDocCanonicalPath(ctx.projectDir, file.id, file.name);
  mkdirSync(join(ctx.projectDir, "noesis", "design-docs"), { recursive: true });
  writeFileSync(path, JSON.stringify(file, null, 2));
  await ctx.designDocs.indexFile(path);
}

async function countOwnedNodes(
  ctx: KnowledgeNewTestContext,
  designDocId: string,
): Promise<Record<string, number>> {
  const labels = [
    "DesignedBoundedContext",
    "DesignedDomainModule",
    "DesignedBuildingBlock",
    "DesignedBehaviour",
    "DesignedProperty",
    "DesignedRule",
    "DesignedScenario",
    "DesignedQualityAttribute",
  ];
  const result: Record<string, number> = {};
  for (const label of labels) {
    const rows = await ctx.db.query<{ id: string }>(
      `MATCH (n:${label}) WHERE n.design_doc_id = $id RETURN n.id AS id`,
      { id: designDocId },
    );
    result[label] = rows.length;
  }
  return result;
}
