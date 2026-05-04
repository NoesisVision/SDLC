import { z } from "zod";
import { newUuid } from "./uuid.js";

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
      "Domain concern. Required ≥80 chars for `added` rules. May be omitted when `modified` only changes other fields. " +
        "Structure: Trigger / Pre-conditions / Algorithm / Post-conditions / Edge cases. " +
        "Tautologies that paraphrase `name` and pure rationale without algorithm are rejected by the quality gate.",
    ),
  edited_by_user: z
    .boolean()
    .optional()
    .describe(
      "True when this element was edited by the user (UI or manual JSON). " +
        "Skill must request explicit confirmation before overwriting.",
    ),
});
export type DesignedRule = z.infer<typeof DesignedRuleSchema>;

export const DesignedScenarioSchema = z.object({
  name: z.string().describe("Concise title, a few words"),
  description: z.string().describe("What the scenario verifies"),
  given: z.string().describe("Precondition or initial context"),
  when: z.string().describe("Action or event that triggers the scenario"),
  then: z.string().describe("Expected outcome or postcondition"),
  edited_by_user: z.boolean().optional(),
});
export type DesignedScenario = z.infer<typeof DesignedScenarioSchema>;

export const DesignedActorSchema = z.object({
  name: z.string(),
  description: z.string().nullable().default(null),
  edited_by_user: z.boolean().optional(),
});
export type DesignedActor = z.infer<typeof DesignedActorSchema>;

export const DesignedQualityAttributeSchema = z.object({
  name: z.string(),
  type: DesignedQualityAttributeTypeSchema.nullable().default(null),
  description: z
    .string()
    .nullable()
    .default(null)
    .describe(
      "Technical concern (performance, availability, security, …). Required ≥80 chars for `added` quality attributes. " +
        "May be omitted when `modified` only changes other fields. " +
        "Should state a measurable expectation (target metric, threshold, scope) rather than a domain invariant — domain invariants belong in `Rule`.",
    ),
  edited_by_user: z.boolean().optional(),
});
export type DesignedQualityAttribute = z.infer<
  typeof DesignedQualityAttributeSchema
>;

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

export const DesignedQualityAttributeChangeSetSchema = changeSetSchema(
  DesignedQualityAttributeSchema,
);
export type DesignedQualityAttributeChangeSet = z.infer<
  typeof DesignedQualityAttributeChangeSetSchema
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
  qualityAttributes: DesignedQualityAttributeChangeSetSchema.optional().describe(
    "Quality attributes (technical concerns) constraining this single behaviour. Attach here only when the constraint does not also apply to the host BuildingBlock or its other behaviours; otherwise lift to the BuildingBlock.",
  ),
  isPublic: z.boolean().default(false),
  actor: z
    .string()
    .nullable()
    .default(null)
    .describe(
      "Name of the actor who initiates this behaviour. Only valid when the host BuildingBlock type is `application_service`; rejected on save otherwise. " +
        "Names are graph-global — call `noesis-graph:list_actors` to reuse an existing actor whenever the persona matches; introduce a new actor (via `noesis-graph:upsert_actor`) only when no existing one fits.",
    ),
  edited_by_user: z.boolean().optional(),
});
export type DesignedBehaviour = z.infer<typeof DesignedBehaviourSchema>;

export const DesignedBehaviourChangeSetSchema = changeSetSchema(
  DesignedBehaviourSchema,
);
export type DesignedBehaviourChangeSet = z.infer<
  typeof DesignedBehaviourChangeSetSchema
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
  qualityAttributes: DesignedQualityAttributeChangeSetSchema.optional().describe(
    "Quality attributes (technical concerns) constraining the BuildingBlock as a whole. Attach here when the constraint covers most/all of its behaviours, or when it cannot be localised to a single behaviour. Promote to Module when it spans sibling BuildingBlocks.",
  ),
  edited_by_user: z.boolean().optional(),
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
  qualityAttributes: DesignedQualityAttributeChangeSetSchema.optional().describe(
    "Quality attributes (technical concerns) covering this Module. Attach here when the constraint spans multiple BuildingBlocks within the Module but not the whole Bounded Context.",
  ),
  edited_by_user: z.boolean().optional(),
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
  qualityAttributes: DesignedQualityAttributeChangeSetSchema.optional().describe(
    "Quality attributes (technical concerns) covering the entire Bounded Context. Attach here only when the constraint cannot be narrowed to one Module / BuildingBlock / Behaviour.",
  ),
  edited_by_user: z.boolean().optional(),
});
export type DesignedBoundedContext = z.infer<
  typeof DesignedBoundedContextSchema
>;

export const DesignedBoundedContextChangeSetSchema = changeSetSchema(
  DesignedBoundedContextSchema,
);
export type DesignedBoundedContextChangeSet = z.infer<
  typeof DesignedBoundedContextChangeSetSchema
>;

export const DesignDocSchema = z.object({
  id: z
    .string()
    .default(() => newUuid())
    .describe("Unique design id. If omitted, a UUID is generated."),
  name: z
    .string()
    .describe(
      "Human-readable design name (e.g. 'auth-system'). Stable across iterations.",
    ),
  description: z
    .string()
    .describe("Summary of what this design change covers"),
  boundedContexts: DesignedBoundedContextChangeSetSchema.optional(),
  edited_by_user: z.boolean().optional(),
  implemented: z
    .boolean()
    .optional()
    .describe(
      "True once `implement-design-doc` has run successfully against this doc. " +
        "Implemented docs are read-only — `save_design_doc` and the UI editor reject mutations until a fresh doc is created.",
    ),
});
export type DesignDoc = z.infer<typeof DesignDocSchema>;

export const DesignDocOverviewSchema = z.object({
  id: z.string(),
  name: z.string(),
  description: z.string(),
  date: z.string(),
  bounded_context_count: z.int(),
  edited_by_user: z.boolean().optional(),
  implemented: z.boolean().optional(),
});
export type DesignDocOverview = z.infer<typeof DesignDocOverviewSchema>;
