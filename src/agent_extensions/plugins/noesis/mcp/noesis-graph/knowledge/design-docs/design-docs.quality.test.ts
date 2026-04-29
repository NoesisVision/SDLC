import { describe, expect, test } from "bun:test";
import type { DesignDoc } from "../../../../shared-contracts/design-doc.js";
import { validateDesignDocQuality } from "./design-docs.service.js";

function placeholderDescription(minLength: number, hint: string): string {
  let body = `${hint}. `;
  while (body.length < minLength) {
    body += `Pre: precondition ${body.length}. Algorithm: step. Post: state. Edge: handle. `;
  }
  return body;
}

const RULE_DESC = placeholderDescription(80, "Rule placeholder");
const BEHAVIOUR_DESC = placeholderDescription(400, "Behaviour placeholder");

function buildDoc(overrides: Partial<DesignDoc>): DesignDoc {
  return {
    id: "dd-q",
    name: "q",
    description: "Quality test design doc",
    ...overrides,
  } as DesignDoc;
}

describe("validateDesignDocQuality — rules", () => {
  test("flags added rule with no description as error", () => {
    const doc = buildDoc({
      boundedContexts: {
        added: [
          {
            name: "BC",
            description: null,
            buildingBlocks: {
              added: [
                {
                  name: "BB",
                  type: null,
                  description: null,
                  rules: {
                    added: [
                      { name: "MissingDesc", ruleType: null, description: null },
                    ],
                    modified: [],
                    removed: [],
                  },
                },
              ],
              modified: [],
              removed: [],
            },
          },
        ],
        modified: [],
        removed: [],
      },
    });
    const { errors } = validateDesignDocQuality(doc);
    expect(errors.length).toBe(1);
    expect(errors[0]).toMatch(/MissingDesc.*missing description/);
  });

  test("flags added rule with description shorter than 80 chars as error", () => {
    const doc = buildDoc({
      boundedContexts: {
        added: [
          {
            name: "BC",
            description: null,
            buildingBlocks: {
              added: [
                {
                  name: "BB",
                  type: null,
                  description: null,
                  rules: {
                    added: [
                      {
                        name: "ShortDesc",
                        ruleType: null,
                        description: "Way too short.",
                      },
                    ],
                    modified: [],
                    removed: [],
                  },
                },
              ],
              modified: [],
              removed: [],
            },
          },
        ],
        modified: [],
        removed: [],
      },
    });
    const { errors } = validateDesignDocQuality(doc);
    expect(errors[0]).toMatch(/ShortDesc.* description is \d+ chars/);
  });

  test("flags tautological rule whose description starts with the name", () => {
    const name = "Order must be paid before shipping";
    const description = `${name}. ${name}. ${name}. ${name}.`;
    expect(description.length).toBeGreaterThan(80);
    const doc = buildDoc({
      boundedContexts: {
        added: [
          {
            name: "BC",
            description: null,
            buildingBlocks: {
              added: [
                {
                  name: "BB",
                  type: null,
                  description: null,
                  rules: {
                    added: [{ name, ruleType: null, description }],
                    modified: [],
                    removed: [],
                  },
                },
              ],
              modified: [],
              removed: [],
            },
          },
        ],
        modified: [],
        removed: [],
      },
    });
    const { errors } = validateDesignDocQuality(doc);
    expect(errors.some((e) => e.includes("tautology"))).toBe(true);
  });

  test("accepts added rule with substantive description", () => {
    const doc = buildDoc({
      boundedContexts: {
        added: [
          {
            name: "BC",
            description: null,
            buildingBlocks: {
              added: [
                {
                  name: "BB",
                  type: null,
                  description: null,
                  rules: {
                    added: [
                      {
                        name: "GoodRule",
                        ruleType: null,
                        description: RULE_DESC,
                      },
                    ],
                    modified: [],
                    removed: [],
                  },
                },
              ],
              modified: [],
              removed: [],
            },
          },
        ],
        modified: [],
        removed: [],
      },
    });
    const report = validateDesignDocQuality(doc);
    expect(report.errors).toEqual([]);
  });

  test("ignores modified rule when description omitted (null)", () => {
    const doc = buildDoc({
      boundedContexts: {
        added: [
          {
            name: "BC",
            description: null,
            buildingBlocks: {
              modified: [
                {
                  name: "BB",
                  type: null,
                  description: null,
                  rules: {
                    added: [],
                    modified: [
                      { name: "OldRule", ruleType: "Consistency", description: null },
                    ],
                    removed: [],
                  },
                },
              ],
              added: [],
              removed: [],
            },
          },
        ],
        modified: [],
        removed: [],
      },
    });
    expect(validateDesignDocQuality(doc).errors).toEqual([]);
  });
});

describe("validateDesignDocQuality — behaviours", () => {
  test("flags added behaviour with description shorter than 400 chars", () => {
    const doc = buildDoc({
      boundedContexts: {
        added: [
          {
            name: "BC",
            description: null,
            buildingBlocks: {
              added: [
                {
                  name: "BB",
                  type: null,
                  description: null,
                  behaviours: {
                    added: [
                      {
                        name: "Shallow",
                        type: "Command",
                        description: "Short body, no algorithm here.",
                        isPublic: false,
                        actor: null,
                      },
                    ],
                    modified: [],
                    removed: [],
                  },
                },
              ],
              modified: [],
              removed: [],
            },
          },
        ],
        modified: [],
        removed: [],
      },
    });
    const { errors } = validateDesignDocQuality(doc);
    expect(errors[0]).toMatch(/Shallow.* description is \d+ chars/);
  });

  test("warns (not errors) when behaviour uses ≥3 building blocks but no mermaid block", () => {
    const doc = buildDoc({
      boundedContexts: {
        added: [
          {
            name: "BC",
            description: null,
            buildingBlocks: {
              added: [
                {
                  name: "Service",
                  type: "application_service",
                  description: null,
                  behaviours: {
                    added: [
                      {
                        name: "Orchestrate",
                        type: "Command",
                        description: BEHAVIOUR_DESC,
                        usedBuildingBlocks: {
                          added: ["A", "B", "C"],
                          modified: [],
                          removed: [],
                        },
                        isPublic: false,
                        actor: null,
                      },
                    ],
                    modified: [],
                    removed: [],
                  },
                },
              ],
              modified: [],
              removed: [],
            },
          },
        ],
        modified: [],
        removed: [],
      },
    });
    const report = validateDesignDocQuality(doc);
    expect(report.errors).toEqual([]);
    expect(report.warnings.some((w) => w.includes("mermaid"))).toBe(true);
  });

  test("does not warn when mermaid block is embedded in description", () => {
    const description =
      `${BEHAVIOUR_DESC} \n\`\`\`mermaid\nsequenceDiagram\nA->>B: tick\n\`\`\``;
    const doc = buildDoc({
      boundedContexts: {
        added: [
          {
            name: "BC",
            description: null,
            buildingBlocks: {
              added: [
                {
                  name: "Service",
                  type: "application_service",
                  description: null,
                  behaviours: {
                    added: [
                      {
                        name: "Orchestrate",
                        type: "Command",
                        description,
                        usedBuildingBlocks: {
                          added: ["A", "B", "C"],
                          modified: [],
                          removed: [],
                        },
                        isPublic: false,
                        actor: null,
                      },
                    ],
                    modified: [],
                    removed: [],
                  },
                },
              ],
              modified: [],
              removed: [],
            },
          },
        ],
        modified: [],
        removed: [],
      },
    });
    expect(validateDesignDocQuality(doc).warnings).toEqual([]);
  });
});

describe("validateDesignDocQuality — dual-level rule attachment", () => {
  test("rejects a Rule attached at both BB and one of its Behaviours", () => {
    const doc = buildDoc({
      boundedContexts: {
        added: [
          {
            name: "BC",
            description: null,
            buildingBlocks: {
              added: [
                {
                  name: "Order",
                  type: "aggregate",
                  description: null,
                  rules: {
                    added: [
                      {
                        name: "DuplicateRule",
                        ruleType: "Consistency",
                        description: RULE_DESC,
                      },
                    ],
                    modified: [],
                    removed: [],
                  },
                  behaviours: {
                    added: [
                      {
                        name: "Place",
                        type: "Command",
                        description: BEHAVIOUR_DESC,
                        isPublic: true,
                        actor: null,
                        rules: {
                          added: [
                            {
                              name: "DuplicateRule",
                              ruleType: "Consistency",
                              description: RULE_DESC,
                            },
                          ],
                          modified: [],
                          removed: [],
                        },
                      },
                    ],
                    modified: [],
                    removed: [],
                  },
                },
              ],
              modified: [],
              removed: [],
            },
          },
        ],
        modified: [],
        removed: [],
      },
    });
    const { errors } = validateDesignDocQuality(doc);
    expect(
      errors.some((e) =>
        e.includes("attached at both Building Block 'Order' and Behaviour 'Place'"),
      ),
    ).toBe(true);
  });

  test("accepts a Rule attached only at the Behaviour level", () => {
    const doc = buildDoc({
      boundedContexts: {
        added: [
          {
            name: "BC",
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
                        name: "Place",
                        type: "Command",
                        description: BEHAVIOUR_DESC,
                        isPublic: true,
                        actor: null,
                        rules: {
                          added: [
                            {
                              name: "OnlyHere",
                              ruleType: "Consistency",
                              description: RULE_DESC,
                            },
                          ],
                          modified: [],
                          removed: [],
                        },
                      },
                    ],
                    modified: [],
                    removed: [],
                  },
                },
              ],
              modified: [],
              removed: [],
            },
          },
        ],
        modified: [],
        removed: [],
      },
    });
    expect(validateDesignDocQuality(doc).errors).toEqual([]);
  });
});

describe("validateDesignDocQuality — removed-but-referenced", () => {
  test("rejects a removed Building Block still referenced as a property type", () => {
    const doc = buildDoc({
      boundedContexts: {
        modified: [
          {
            name: "BC",
            description: null,
            buildingBlocks: {
              added: [
                {
                  name: "Order",
                  type: "aggregate",
                  description: null,
                  properties: {
                    added: [{ name: "lock", type: "Lock" }],
                    modified: [],
                    removed: [],
                  },
                },
              ],
              modified: [],
              removed: ["Lock"],
            },
          },
        ],
        added: [],
        removed: [],
      },
    });
    const { errors } = validateDesignDocQuality(doc);
    expect(
      errors.some(
        (e) =>
          e.includes("'Lock'") &&
          e.includes("removed") &&
          e.includes("property type"),
      ),
    ).toBe(true);
  });

  test("rejects a removed Building Block still referenced via implements", () => {
    const doc = buildDoc({
      boundedContexts: {
        modified: [
          {
            name: "BC",
            description: null,
            buildingBlocks: {
              added: [
                {
                  name: "ConcreteThing",
                  type: "value_object",
                  description: null,
                  implements: ["LegacyBase"],
                },
              ],
              modified: [],
              removed: ["LegacyBase"],
            },
          },
        ],
        added: [],
        removed: [],
      },
    });
    const { errors } = validateDesignDocQuality(doc);
    expect(
      errors.some(
        (e) => e.includes("'LegacyBase'") && e.includes("implements"),
      ),
    ).toBe(true);
  });

  test("does not flag references when nothing is in removed", () => {
    const doc = buildDoc({
      boundedContexts: {
        added: [
          {
            name: "BC",
            description: null,
            buildingBlocks: {
              added: [
                {
                  name: "Order",
                  type: "aggregate",
                  description: null,
                  properties: {
                    added: [{ name: "id", type: "OrderId" }],
                    modified: [],
                    removed: [],
                  },
                },
              ],
              modified: [],
              removed: [],
            },
          },
        ],
        modified: [],
        removed: [],
      },
    });
    expect(validateDesignDocQuality(doc).errors).toEqual([]);
  });
});

describe("validateDesignDocQuality — implements resolution", () => {
  test("warns when implements references a BB not declared in this doc", () => {
    const doc = buildDoc({
      boundedContexts: {
        added: [
          {
            name: "BC",
            description: null,
            buildingBlocks: {
              added: [
                {
                  name: "ConcreteLeaf",
                  type: "value_object",
                  description: null,
                  implements: ["NotDeclaredBase"],
                },
              ],
              modified: [],
              removed: [],
            },
          },
        ],
        modified: [],
        removed: [],
      },
    });
    const { warnings } = validateDesignDocQuality(doc);
    expect(
      warnings.some(
        (w) => w.includes("'NotDeclaredBase'") && w.includes("implements"),
      ),
    ).toBe(true);
  });

  test("does not warn when the base BB is declared alongside", () => {
    const doc = buildDoc({
      boundedContexts: {
        added: [
          {
            name: "BC",
            description: null,
            buildingBlocks: {
              added: [
                {
                  name: "Component",
                  type: "value_object",
                  description: null,
                },
                {
                  name: "CompositeComponent",
                  type: "value_object",
                  description: null,
                  implements: ["Component"],
                },
              ],
              modified: [],
              removed: [],
            },
          },
        ],
        modified: [],
        removed: [],
      },
    });
    const { warnings } = validateDesignDocQuality(doc);
    expect(warnings.some((w) => w.includes("'Component'"))).toBe(false);
  });
});

describe("validateDesignDocQuality — bounded context saturation", () => {
  test("warns when BC has >20 building blocks and zero modules", () => {
    const blocks = Array.from({ length: 25 }, (_, i) => ({
      name: `Block${i}`,
      type: "value_object" as const,
      description: null,
    }));
    const doc = buildDoc({
      boundedContexts: {
        added: [
          {
            name: "Big",
            description: null,
            buildingBlocks: { added: blocks, modified: [], removed: [] },
          },
        ],
        modified: [],
        removed: [],
      },
    });
    const report = validateDesignDocQuality(doc);
    expect(report.errors).toEqual([]);
    expect(report.warnings.some((w) => w.includes("'Big'"))).toBe(true);
  });

  test("does not warn when BC has modules even with many BBs", () => {
    const blocks = Array.from({ length: 25 }, (_, i) => ({
      name: `Block${i}`,
      type: "value_object" as const,
      description: null,
    }));
    const doc = buildDoc({
      boundedContexts: {
        added: [
          {
            name: "Big",
            description: null,
            modules: {
              added: [{ name: "Group", description: null }],
              modified: [],
              removed: [],
            },
            buildingBlocks: { added: blocks, modified: [], removed: [] },
          },
        ],
        modified: [],
        removed: [],
      },
    });
    expect(validateDesignDocQuality(doc).warnings).toEqual([]);
  });
});
