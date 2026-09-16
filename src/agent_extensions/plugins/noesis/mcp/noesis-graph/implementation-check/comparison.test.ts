import { describe, test, expect } from "bun:test";
import { compareImplementation } from "./comparison.js";
import type { DesignDocFile } from "../../../shared-contracts/design-doc.js";
import type {
  BuildingBlockBranch,
  DomainModelTree,
} from "../scanner/domain-model/domain-model.js";

function emptyTree(): DomainModelTree {
  return { boundedContexts: [] };
}

function bb(
  name: string,
  type: string,
  behaviorNames: string[] = [],
  behaviourActors: Record<string, string> = {},
): BuildingBlockBranch {
  return {
    id: `${name}.cs:${name}`,
    name,
    type,
    behaviors: behaviorNames.map((n) => ({
      id: `${name}.cs:${name}:${n}`,
      name: n,
      actor: behaviourActors[n] ?? null,
    })),
    properties: [],
  };
}

function tree(spec: TreeSpec): DomainModelTree {
  return {
    boundedContexts: spec.bcs.map((b) => ({
      name: b.name,
      modules: (b.modules ?? []).map((m) => ({
        name: m.name,
        fullPath: `${b.name}.${m.name}`,
        modules: [],
        buildingBlocks: m.buildingBlocks ?? [],
      })),
      buildingBlocks: b.buildingBlocks ?? [],
    })),
  };
}

interface TreeSpec {
  bcs: Array<{
    name: string;
    modules?: Array<{ name: string; buildingBlocks?: BuildingBlockBranch[] }>;
    buildingBlocks?: BuildingBlockBranch[];
  }>;
}

function emptyDoc(overrides: Partial<DesignDocFile> = {}): DesignDocFile {
  return {
    id: "doc-1",
    name: "test",
    description: "test",
    ...overrides,
  } as DesignDocFile;
}

describe("compareImplementation", () => {
  test("Ok when before equals after and design doc has no changes", () => {
    const result = compareImplementation({
      before: emptyTree(),
      after: emptyTree(),
      doc: emptyDoc(),
    });
    expect(result.status).toBe("Ok");
    expect(result.problems).toEqual([]);
  });

  test("Ok when added BoundedContext + Module + BB + Behavior match design doc", () => {
    const after = tree({
      bcs: [
        {
          name: "Sales",
          modules: [{ name: "Orders", buildingBlocks: [bb("Order", "aggregate", ["Submit"])] }],
        },
      ],
    });
    const doc = emptyDoc({
      boundedContexts: {
        added: [
          {
            name: "Sales",
            description: null,
            modules: {
              added: [
                {
                  name: "Orders",
                  description: null,
                  buildingBlocks: {
                    added: [
                      {
                        name: "Order",
                        type: "aggregate",
                        description: null,
                        behaviours: {
                          added: [
                            {
                              name: "Submit",
                              description: null,
                              type: null,
                              isPublic: false,
                              actor: null,
                            } as never,
                          ],
                          removed: [],
                          modified: [],
                        },
                      } as never,
                    ],
                    removed: [],
                    modified: [],
                  },
                },
              ],
              removed: [],
              modified: [],
            },
          },
        ],
        removed: [],
        modified: [],
      },
    } as never);
    const result = compareImplementation({ before: emptyTree(), after, doc });
    expect(result).toEqual({ status: "Ok", problems: [] });
  });

  test("flags missing change when design doc adds a BB but it is not in after", () => {
    const after = emptyTree();
    const doc = emptyDoc({
      boundedContexts: {
        added: [
          {
            name: "Sales",
            description: null,
            buildingBlocks: {
              added: [{ name: "Order", type: "aggregate", description: null } as never],
              removed: [],
              modified: [],
            },
          },
        ],
        removed: [],
        modified: [],
      },
    } as never);
    const result = compareImplementation({ before: emptyTree(), after, doc });
    expect(result.status).toBe("Mismatch");
    expect(result.problems.some((p) => p.includes("BoundedContext 'Sales'"))).toBe(true);
    expect(result.problems.some((p) => p.includes("BuildingBlock 'Sales/Order'"))).toBe(true);
  });

  test("flags unexpected addition when after has a BB the design doc never declared", () => {
    const after = tree({
      bcs: [{ name: "Sales", buildingBlocks: [bb("Surprise", "value_object")] }],
    });
    const doc = emptyDoc({
      boundedContexts: {
        added: [{ name: "Sales", description: null }],
        removed: [],
        modified: [],
      },
    } as never);
    const result = compareImplementation({ before: emptyTree(), after, doc });
    expect(result.status).toBe("Mismatch");
    expect(
      result.problems.some(
        (p) => p.includes("Unexpected change") && p.includes("Sales/Surprise"),
      ),
    ).toBe(true);
  });

  test("flags missing removal when design doc removes a BB but after still has it", () => {
    const before = tree({ bcs: [{ name: "Sales", buildingBlocks: [bb("Stale", "entity")] }] });
    const after = before;
    const doc = emptyDoc({
      boundedContexts: {
        modified: [
          {
            name: "Sales",
            description: null,
            buildingBlocks: { added: [], removed: ["Stale"], modified: [] },
          },
        ],
        added: [],
        removed: [],
      },
    } as never);
    const result = compareImplementation({ before, after, doc });
    expect(result.status).toBe("Mismatch");
    expect(
      result.problems.some(
        (p) => p.includes("Missing change") && p.includes("Sales/Stale"),
      ),
    ).toBe(true);
  });

  test("does not flag unexpected removals that cascade from a removed Bounded Context", () => {
    const before = tree({
      bcs: [
        {
          name: "Legacy",
          modules: [
            {
              name: "Stuff",
              buildingBlocks: [bb("OldBlock", "entity", ["OldBehavior"])],
            },
          ],
        },
      ],
    });
    const after = emptyTree();
    const doc = emptyDoc({
      boundedContexts: {
        added: [],
        modified: [],
        removed: ["Legacy"],
      },
    } as never);
    const result = compareImplementation({ before, after, doc });
    expect(result).toEqual({ status: "Ok", problems: [] });
  });

  test("flags BB type drift even when design doc says only modified", () => {
    const before = tree({
      bcs: [{ name: "Sales", buildingBlocks: [bb("Customer", "entity")] }],
    });
    const after = tree({
      bcs: [{ name: "Sales", buildingBlocks: [bb("Customer", "value_object")] }],
    });
    const doc = emptyDoc({
      boundedContexts: {
        modified: [
          {
            name: "Sales",
            description: null,
          },
        ],
        added: [],
        removed: [],
      },
    } as never);
    const result = compareImplementation({ before, after, doc });
    expect(result.status).toBe("Mismatch");
    expect(
      result.problems.some(
        (p) => p.includes("Unexpected change") && p.includes("modified BuildingBlock 'Sales/Customer'"),
      ),
    ).toBe(true);
  });

  test("accepts behavior added under a BB that the design doc marks modified", () => {
    const before = tree({
      bcs: [{ name: "Sales", buildingBlocks: [bb("Customer", "aggregate", [])] }],
    });
    const after = tree({
      bcs: [{ name: "Sales", buildingBlocks: [bb("Customer", "aggregate", ["Greet"])] }],
    });
    const doc = emptyDoc({
      boundedContexts: {
        modified: [
          {
            name: "Sales",
            description: null,
            buildingBlocks: {
              added: [],
              removed: [],
              modified: [
                {
                  name: "Customer",
                  type: "aggregate",
                  description: null,
                  behaviours: {
                    added: [
                      {
                        name: "Greet",
                        description: null,
                        type: null,
                        isPublic: false,
                        actor: null,
                      } as never,
                    ],
                    removed: [],
                    modified: [],
                  },
                } as never,
              ],
            },
          },
        ],
        added: [],
        removed: [],
      },
    } as never);
    const result = compareImplementation({ before, after, doc });
    expect(result).toEqual({ status: "Ok", problems: [] });
  });

  test("Mismatch when expected actor is missing on the post-impl scan", () => {
    const after = tree({
      bcs: [
        {
          name: "Sales",
          buildingBlocks: [bb("OrderApi", "ApplicationService", ["Place"])],
        },
      ],
    });
    const doc = emptyDoc({
      boundedContexts: {
        added: [
          {
            name: "Sales",
            description: null,
            buildingBlocks: {
              added: [
                {
                  name: "OrderApi",
                  type: "application_service",
                  description: null,
                  behaviours: {
                    added: [
                      {
                        name: "Place",
                        description: null,
                        type: null,
                        isPublic: true,
                        actor: "Customer",
                      } as never,
                    ],
                    removed: [],
                    modified: [],
                  },
                } as never,
              ],
              removed: [],
              modified: [],
            },
          },
        ],
        removed: [],
        modified: [],
      },
    } as never);
    const result = compareImplementation({ before: emptyTree(), after, doc });
    expect(result.status).toBe("Mismatch");
    expect(
      result.problems.some(
        (p) => p.includes("missing the [Actor(\"Customer\")]") && p.includes("Place"),
      ),
    ).toBe(true);
  });

  test("Mismatch when scanned actor differs from the doc's declared actor", () => {
    const after = tree({
      bcs: [
        {
          name: "Sales",
          buildingBlocks: [
            bb(
              "OrderApi",
              "ApplicationService",
              ["Place"],
              { Place: "Operator" },
            ),
          ],
        },
      ],
    });
    const doc = emptyDoc({
      boundedContexts: {
        added: [
          {
            name: "Sales",
            description: null,
            buildingBlocks: {
              added: [
                {
                  name: "OrderApi",
                  type: "application_service",
                  description: null,
                  behaviours: {
                    added: [
                      {
                        name: "Place",
                        description: null,
                        type: null,
                        isPublic: true,
                        actor: "Customer",
                      } as never,
                    ],
                    removed: [],
                    modified: [],
                  },
                } as never,
              ],
              removed: [],
              modified: [],
            },
          },
        ],
        removed: [],
        modified: [],
      },
    } as never);
    const result = compareImplementation({ before: emptyTree(), after, doc });
    expect(result.status).toBe("Mismatch");
    expect(
      result.problems.some(
        (p) =>
          p.includes("has actor 'Operator'") && p.includes("declares 'Customer'"),
      ),
    ).toBe(true);
  });

  test("Ok when the scanned actor matches the doc's declared actor", () => {
    const after = tree({
      bcs: [
        {
          name: "Sales",
          buildingBlocks: [
            bb(
              "OrderApi",
              "ApplicationService",
              ["Place"],
              { Place: "Customer" },
            ),
          ],
        },
      ],
    });
    const doc = emptyDoc({
      boundedContexts: {
        added: [
          {
            name: "Sales",
            description: null,
            buildingBlocks: {
              added: [
                {
                  name: "OrderApi",
                  type: "application_service",
                  description: null,
                  behaviours: {
                    added: [
                      {
                        name: "Place",
                        description: null,
                        type: null,
                        isPublic: true,
                        actor: "Customer",
                      } as never,
                    ],
                    removed: [],
                    modified: [],
                  },
                } as never,
              ],
              removed: [],
              modified: [],
            },
          },
        ],
        removed: [],
        modified: [],
      },
    } as never);
    const result = compareImplementation({ before: emptyTree(), after, doc });
    expect(result).toEqual({ status: "Ok", problems: [] });
  });
});
