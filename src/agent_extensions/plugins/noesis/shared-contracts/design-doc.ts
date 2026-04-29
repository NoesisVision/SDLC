import { randomUUID } from "crypto";
import { z } from "zod";

export const DesignedBuildingBlockTypeSchema = z.enum([
  "aggregate",
  "entity",
  "value_object",
  "domain_event",
  "domain_command",
  "domain_query",
  "domain_service",
  "application_service",
  "repository",
  "factory",
  "external_integration",
]);
export type DesignedBuildingBlockType = z.infer<
  typeof DesignedBuildingBlockTypeSchema
>;

export const DesignedQualityAttributeTypeSchema = z.enum([
  "performance",
  "availability",
  "security",
  "other",
]);
export type DesignedQualityAttributeType = z.infer<
  typeof DesignedQualityAttributeTypeSchema
>;

export const DesignedRuleTypeSchema = z.enum([
  "Consistency",
  "Structure",
  "Computation",
  "State change",
]);
export type DesignedRuleType = z.infer<typeof DesignedRuleTypeSchema>;

export const DesignedBehaviourTypeSchema = z.enum([
  "Command",
  "Event",
  "Query",
]);
export type DesignedBehaviourType = z.infer<typeof DesignedBehaviourTypeSchema>;

export const DesignedPropertySchema = z.object({
  name: z.string(),
  type: z
    .string()
    .nullable()
    .default(null)
    .describe("BuildingBlock name or primitive type name"),
  description: z
    .string()
    .optional()
    .describe(
      "Optional free-form per-property note (range, format, special semantics) that does not fit `type` or a Rule.",
    ),
  nullable: z
    .boolean()
    .optional()
    .describe("True when the property may be absent on an instance. Defaults to false when omitted."),
  collection: z
    .boolean()
    .optional()
    .describe("True when the property holds a list of `type` values. Defaults to false when omitted."),
});
export type DesignedProperty = z.infer<typeof DesignedPropertySchema>;

export const DesignedRuleSchema = z.object({
  name: z.string(),
  ruleType: DesignedRuleTypeSchema.nullable().default(null),
  description: z
    .string()
    .nullable()
    .default(null)
    .describe(
      "Required ≥80 chars for `added` rules. May be omitted when `modified` only changes other fields. " +
        "Structure: Trigger / Pre-conditions / Algorithm / Post-conditions / Edge cases. " +
        "Tautologies that paraphrase `name` and pure rationale without algorithm are rejected by the quality gate.",
    ),
});
export type DesignedRule = z.infer<typeof DesignedRuleSchema>;

export const DesignedScenarioSchema = z.object({
  name: z.string().describe("Concise title, a few words"),
  description: z.string().describe("What the scenario verifies"),
  given: z.string().describe("Precondition or initial context"),
  when: z.string().describe("Action or event that triggers the scenario"),
  then: z.string().describe("Expected outcome or postcondition"),
});
export type DesignedScenario = z.infer<typeof DesignedScenarioSchema>;

function changeSetSchema<T extends z.ZodTypeAny>(itemSchema: T) {
  return z.object({
    added: z.array(itemSchema).default([]),
    removed: z
      .array(z.string())
      .default([])
      .describe("Names of elements to remove"),
    modified: z
      .array(itemSchema)
      .default([])
      .describe("Elements with only changed fields set"),
  });
}

export const StringChangeSetSchema = changeSetSchema(z.string());
export type StringChangeSet = z.infer<typeof StringChangeSetSchema>;

export const DesignedPropertyChangeSetSchema = changeSetSchema(
  DesignedPropertySchema,
);
export type DesignedPropertyChangeSet = z.infer<
  typeof DesignedPropertyChangeSetSchema
>;

export const DesignedRuleChangeSetSchema = changeSetSchema(DesignedRuleSchema);
export type DesignedRuleChangeSet = z.infer<typeof DesignedRuleChangeSetSchema>;

export const DesignedScenarioChangeSetSchema = changeSetSchema(
  DesignedScenarioSchema,
);
export type DesignedScenarioChangeSet = z.infer<
  typeof DesignedScenarioChangeSetSchema
>;

export const DesignedBehaviourSchema = z.object({
  name: z.string().describe("Concise name, a few words"),
  description: z
    .string()
    .nullable()
    .default(null)
    .describe(
      "Required ≥400 chars for `added` behaviours. May be omitted when `modified` only changes other fields. " +
        "Structure: Input / Validation+preconditions / numbered Steps with the transactional boundary / Output. " +
        "For application_service behaviours or those using ≥3 building blocks, embed a ```mermaid sequence diagram (warning, not error).",
    ),
  type: DesignedBehaviourTypeSchema.nullable().default(null),
  input: StringChangeSetSchema.optional().describe(
    "Input BuildingBlock names; omit when no changes",
  ),
  output: StringChangeSetSchema.optional().describe(
    "Output BuildingBlock names; omit when no changes",
  ),
  usedBuildingBlocks: StringChangeSetSchema.optional().describe(
    "Referenced BuildingBlock names; omit when no changes",
  ),
  rules: DesignedRuleChangeSetSchema.optional(),
  scenarios: DesignedScenarioChangeSetSchema.optional(),
  isPublic: z.boolean().default(false),
  actor: z
    .string()
    .nullable()
    .default(null)
    .describe("Name of the actor who initiates this behaviour"),
});
export type DesignedBehaviour = z.infer<typeof DesignedBehaviourSchema>;

export const DesignedBehaviourChangeSetSchema = changeSetSchema(
  DesignedBehaviourSchema,
);
export type DesignedBehaviourChangeSet = z.infer<
  typeof DesignedBehaviourChangeSetSchema
>;

export const DesignedActorSchema = z.object({
  name: z.string(),
  description: z.string().nullable().default(null),
});
export type DesignedActor = z.infer<typeof DesignedActorSchema>;

export const DesignedQualityAttributeSchema = z.object({
  name: z.string(),
  type: DesignedQualityAttributeTypeSchema.nullable().default(null),
  description: z
    .string()
    .nullable()
    .default(null)
    .describe("Measurable quality expectation"),
});
export type DesignedQualityAttribute = z.infer<
  typeof DesignedQualityAttributeSchema
>;

export const DesignedBuildingBlockSchema = z.object({
  name: z.string(),
  type: DesignedBuildingBlockTypeSchema.nullable().default(null),
  description: z.string().nullable().default(null),
  implements: z
    .array(z.string())
    .optional()
    .describe(
      "Names of base Building Blocks this block implements (OOP-style polymorphism). " +
        "Each entry must resolve to another declared Building Block in the same DesignDoc or in the prior model. " +
        "Defaults to an empty list when omitted.",
    ),
  properties: DesignedPropertyChangeSetSchema.optional(),
  behaviours: DesignedBehaviourChangeSetSchema.optional(),
  rules: DesignedRuleChangeSetSchema.optional(),
  scenarios: DesignedScenarioChangeSetSchema.optional(),
});
export type DesignedBuildingBlock = z.infer<typeof DesignedBuildingBlockSchema>;

export const DesignedBuildingBlockChangeSetSchema = changeSetSchema(
  DesignedBuildingBlockSchema,
);
export type DesignedBuildingBlockChangeSet = z.infer<
  typeof DesignedBuildingBlockChangeSetSchema
>;

export const DesignedDomainModuleSchema = z.object({
  name: z.string(),
  description: z.string().nullable().default(null),
  buildingBlocks: DesignedBuildingBlockChangeSetSchema.optional(),
});
export type DesignedDomainModule = z.infer<typeof DesignedDomainModuleSchema>;

export const DesignedDomainModuleChangeSetSchema = changeSetSchema(
  DesignedDomainModuleSchema,
);
export type DesignedDomainModuleChangeSet = z.infer<
  typeof DesignedDomainModuleChangeSetSchema
>;

export const DesignedBoundedContextSchema = z.object({
  name: z.string(),
  description: z
    .string()
    .nullable()
    .default(null)
    .describe("Scope and responsibility of this context"),
  modules: DesignedDomainModuleChangeSetSchema.optional(),
  buildingBlocks: DesignedBuildingBlockChangeSetSchema.optional().describe(
    "Building blocks not belonging to any module",
  ),
});
export type DesignedBoundedContext = z.infer<
  typeof DesignedBoundedContextSchema
>;

export const DesignedActorChangeSetSchema = changeSetSchema(DesignedActorSchema);
export type DesignedActorChangeSet = z.infer<
  typeof DesignedActorChangeSetSchema
>;

export const DesignedBoundedContextChangeSetSchema = changeSetSchema(
  DesignedBoundedContextSchema,
);
export type DesignedBoundedContextChangeSet = z.infer<
  typeof DesignedBoundedContextChangeSetSchema
>;

export const DesignedQualityAttributeChangeSetSchema = changeSetSchema(
  DesignedQualityAttributeSchema,
);
export type DesignedQualityAttributeChangeSet = z.infer<
  typeof DesignedQualityAttributeChangeSetSchema
>;

export const DesignDocSchema = z.object({
  id: z
    .string()
    .default(() => randomUUID())
    .describe("Unique design id. If omitted, a UUID is generated."),
  name: z
    .string()
    .describe(
      "Human-readable design name (e.g. 'auth-system'). Stable across iterations.",
    ),
  description: z
    .string()
    .describe("Summary of what this design change covers"),
  actors: DesignedActorChangeSetSchema.optional(),
  boundedContexts: DesignedBoundedContextChangeSetSchema.optional(),
  qualityAttributes: DesignedQualityAttributeChangeSetSchema.optional(),
});
export type DesignDoc = z.infer<typeof DesignDocSchema>;

export const DesignDocOverviewSchema = z.object({
  id: z.string(),
  name: z.string(),
  description: z.string(),
  date: z.string(),
  actor_count: z.int(),
  bounded_context_count: z.int(),
  quality_attribute_count: z.int(),
});
export type DesignDocOverview = z.infer<typeof DesignDocOverviewSchema>;
