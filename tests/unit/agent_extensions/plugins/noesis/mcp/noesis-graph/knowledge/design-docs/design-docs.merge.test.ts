import { describe, expect, test } from "bun:test";
import { and, given, then, when } from "@tests/bdd.js";
import {
  DesignDocFileSchema,
  type DesignDocFile,
  type DesignedBehaviour,
  type DesignedBoundedContext,
  type DesignedBuildingBlock,
  type DesignedScenario,
} from "@noesis/shared-contracts/design-doc.js";
import { mergeDesignDocFiles } from "@noesis/mcp/noesis-graph/knowledge/design-docs/design-docs.merge.js";

describe("mergeDesignDocFiles — delta upload semantics for design docs", () => {
  test("adding a new scenario to an existing behaviour preserves the original scenarios", () => {
    let merged: DesignDocFile;

    const existing = designDoc({
      boundedContexts: {
        added: [
          boundedContext({
            name: "Sales",
            buildingBlocks: {
              added: [
                buildingBlock({
                  name: "Cart",
                  behaviours: {
                    added: [
                      behaviour({
                        name: "AddItem",
                        scenarios: {
                          added: [scenario({ name: "ItemAdded" })],
                          modified: [],
                          removed: [],
                        },
                      }),
                    ],
                    modified: [],
                    removed: [],
                  },
                }),
              ],
              modified: [],
              removed: [],
            },
          }),
        ],
        modified: [],
        removed: [],
      },
    });

    const incoming = designDoc({
      boundedContexts: {
        added: [
          boundedContext({
            name: "Sales",
            buildingBlocks: {
              added: [
                buildingBlock({
                  name: "Cart",
                  behaviours: {
                    added: [
                      behaviour({
                        name: "AddItem",
                        scenarios: {
                          added: [scenario({ name: "ItemRemovedFromCart" })],
                          modified: [],
                          removed: [],
                        },
                      }),
                    ],
                    modified: [],
                    removed: [],
                  },
                }),
              ],
              modified: [],
              removed: [],
            },
          }),
        ],
        modified: [],
        removed: [],
      },
    });

    given("an existing design doc whose AddItem behaviour carries one scenario", () => {
      void existing;
    });
    when("an iteration uploads only the new ItemRemovedFromCart scenario under the same behaviour", () => {
      merged = mergeDesignDocFiles(existing, incoming);
    });
    then("the merged behaviour carries both the original and the new scenario", () => {
      const scenarios = merged.boundedContexts!.added[0]!.buildingBlocks!.added[0]!
        .behaviours!.added[0]!.scenarios!;
      expect(scenarios.added.map((s) => s.name).sort()).toEqual([
        "ItemAdded",
        "ItemRemovedFromCart",
      ]);
    });
  });

  test("modifying a scalar field on an existing item replaces only that field", () => {
    let merged: DesignDocFile;

    const existing = designDoc({
      boundedContexts: {
        added: [boundedContext({ name: "Sales", description: "Original sales BC" })],
        modified: [],
        removed: [],
      },
    });

    const incoming = designDoc({
      boundedContexts: {
        added: [boundedContext({ name: "Sales", description: "Revised sales BC" })],
        modified: [],
        removed: [],
      },
    });

    when("an iteration uploads the same BC with a revised description", () => {
      merged = mergeDesignDocFiles(existing, incoming);
    });
    then("the merged BC carries the incoming description", () => {
      expect(merged.boundedContexts!.added[0]!.description).toBe("Revised sales BC");
    });
  });

  test("an item appearing in incoming.modified moves out of existing.added", () => {
    let merged: DesignDocFile;

    const existing = designDoc({
      boundedContexts: {
        added: [boundedContext({ name: "Sales" })],
        modified: [],
        removed: [],
      },
    });

    const incoming = designDoc({
      boundedContexts: {
        added: [],
        modified: [boundedContext({ name: "Sales", description: "Sales after first implementation" })],
        removed: [],
      },
    });

    when("the iteration promotes Sales from added to modified", () => {
      merged = mergeDesignDocFiles(existing, incoming);
    });
    then("the merged document has Sales in modified only, not added", () => {
      expect(merged.boundedContexts!.added).toHaveLength(0);
      expect(merged.boundedContexts!.modified.map((bc) => bc.name)).toEqual(["Sales"]);
    });
  });

  test("an item named in incoming.removed is dropped from existing.added", () => {
    let merged: DesignDocFile;

    const existing = designDoc({
      boundedContexts: {
        added: [
          boundedContext({ name: "Sales" }),
          boundedContext({ name: "Reporting" }),
        ],
        modified: [],
        removed: [],
      },
    });

    const incoming = designDoc({
      boundedContexts: {
        added: [],
        modified: [],
        removed: ["Reporting"],
      },
    });

    when("the iteration removes Reporting by name", () => {
      merged = mergeDesignDocFiles(existing, incoming);
    });
    then("only Sales survives in added", () => {
      expect(merged.boundedContexts!.added.map((bc) => bc.name)).toEqual(["Sales"]);
    });
    and("Reporting is listed in removed", () => {
      expect(merged.boundedContexts!.removed).toEqual(["Reporting"]);
    });
  });

  test("incoming behaviour input/output deltas extend the existing string change sets", () => {
    let merged: DesignDocFile;

    const existing = designDoc({
      boundedContexts: {
        added: [
          boundedContext({
            name: "Sales",
            buildingBlocks: {
              added: [
                buildingBlock({
                  name: "Cart",
                  behaviours: {
                    added: [
                      behaviour({
                        name: "AddItem",
                        input: { added: ["ItemId"], modified: [], removed: [] },
                        output: { added: ["CartLine"], modified: [], removed: [] },
                      }),
                    ],
                    modified: [],
                    removed: [],
                  },
                }),
              ],
              modified: [],
              removed: [],
            },
          }),
        ],
        modified: [],
        removed: [],
      },
    });

    const incoming = designDoc({
      boundedContexts: {
        added: [
          boundedContext({
            name: "Sales",
            buildingBlocks: {
              added: [
                buildingBlock({
                  name: "Cart",
                  behaviours: {
                    added: [
                      behaviour({
                        name: "AddItem",
                        input: { added: ["Quantity"], modified: [], removed: [] },
                      }),
                    ],
                    modified: [],
                    removed: [],
                  },
                }),
              ],
              modified: [],
              removed: [],
            },
          }),
        ],
        modified: [],
        removed: [],
      },
    });

    when("the iteration adds a second input parameter without restating the first", () => {
      merged = mergeDesignDocFiles(existing, incoming);
    });
    then("the merged behaviour input lists both parameters", () => {
      const beh = merged.boundedContexts!.added[0]!.buildingBlocks!.added[0]!
        .behaviours!.added[0]!;
      expect(beh.input!.added.sort()).toEqual(["ItemId", "Quantity"]);
    });
    and("the original output survives even though the iteration did not mention it", () => {
      const beh = merged.boundedContexts!.added[0]!.buildingBlocks!.added[0]!
        .behaviours!.added[0]!;
      expect(beh.output!.added).toEqual(["CartLine"]);
    });
  });

  test("merging against a null existing returns the incoming document unchanged", () => {
    const incoming = designDoc({ name: "fresh-doc" });
    const merged = mergeDesignDocFiles(null, incoming);
    expect(merged).toBe(incoming);
  });
});

function designDoc(overrides: Partial<DesignDocFile> = {}): DesignDocFile {
  return DesignDocFileSchema.parse({
    id: "01928000-0000-7000-8000-000000000001",
    name: "billing",
    description: "Billing context.",
    actors: [],
    boundedContexts: { added: [], removed: [], modified: [] },
    implemented: false,
    ...overrides,
  });
}

function boundedContext(
  overrides: Partial<DesignedBoundedContext> & { name: string },
): DesignedBoundedContext {
  return {
    name_locked: false,
    description: null,
    description_locked: false,
    ...overrides,
  };
}

function buildingBlock(
  overrides: Partial<DesignedBuildingBlock> & { name: string },
): DesignedBuildingBlock {
  return {
    name_locked: false,
    type: null,
    type_locked: false,
    description: null,
    description_locked: false,
    ...overrides,
  };
}

function behaviour(
  overrides: Partial<DesignedBehaviour> & { name: string },
): DesignedBehaviour {
  return {
    name_locked: false,
    description: null,
    description_locked: false,
    type: null,
    type_locked: false,
    isPublic: false,
    actor: null,
    actor_locked: false,
    ...overrides,
  };
}

function scenario(
  overrides: Partial<DesignedScenario> & { name: string },
): DesignedScenario {
  return {
    name_locked: false,
    description: "",
    description_locked: false,
    given: "",
    given_locked: false,
    when: "",
    when_locked: false,
    then: "",
    then_locked: false,
    ...overrides,
  };
}

