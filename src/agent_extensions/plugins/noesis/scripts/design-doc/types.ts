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
export type DesignedBuildingBlockType = z.infer<typeof DesignedBuildingBlockTypeSchema>;

export const DesignedQualityAttributeTypeSchema = z.enum([
  "performance",
  "availability",
  "security",
  "other",
]);
export type DesignedQualityAttributeType = z.infer<typeof DesignedQualityAttributeTypeSchema>;

export const DesignedRuleTypeSchema = z.enum([
  "Consistency",
  "Structure",
  "Computation",
  "State change",
]);
export type DesignedRuleType = z.infer<typeof DesignedRuleTypeSchema>;

export const DesignedBehaviorTypeSchema = z.enum(["Command", "Event", "Query"]);
export type DesignedBehaviorType = z.infer<typeof DesignedBehaviorTypeSchema>;

export const DesignedPropertySchema = z.object({
  name: z.string(),
  type: z
    .string()
    .nullable()
    .default(null)
    .describe("BuildingBlock name or primitive type name"),
});
export type DesignedProperty = z.infer<typeof DesignedPropertySchema>;

export const DesignedRuleSchema = z.object({
  name: z.string(),
  ruleType: DesignedRuleTypeSchema.nullable().default(null),
  description: z.string().nullable().default(null),
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
export const DesignedPropertyChangeSetSchema = changeSetSchema(DesignedPropertySchema);
export const DesignedRuleChangeSetSchema = changeSetSchema(DesignedRuleSchema);
export const DesignedScenarioChangeSetSchema = changeSetSchema(DesignedScenarioSchema);

export const DesignedBehaviourSchema = z.object({
  name: z.string().describe("Concise name, a few words"),
  description: z.string().nullable().default(null),
  type: DesignedBehaviorTypeSchema.nullable().default(null),
  input: StringChangeSetSchema.nullable()
    .default(null)
    .describe("Input BuildingBlock names"),
  output: StringChangeSetSchema.nullable()
    .default(null)
    .describe("Output BuildingBlock names"),
  usedBuildingBlocks: StringChangeSetSchema.nullable()
    .default(null)
    .describe("Referenced BuildingBlock names"),
  rules: DesignedRuleChangeSetSchema.nullable().default(null),
  scenarios: DesignedScenarioChangeSetSchema.nullable().default(null),
  isPublic: z.boolean().default(false),
  actor: z
    .string()
    .nullable()
    .default(null)
    .describe("Name of the actor who initiates this behaviour"),
});
export type DesignedBehaviour = z.infer<typeof DesignedBehaviourSchema>;

export const DesignedBehaviourChangeSetSchema = changeSetSchema(DesignedBehaviourSchema);

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
export type DesignedQualityAttribute = z.infer<typeof DesignedQualityAttributeSchema>;

export const DesignedBuildingBlockSchema = z.object({
  name: z.string(),
  type: DesignedBuildingBlockTypeSchema.nullable().default(null),
  description: z.string().nullable().default(null),
  properties: DesignedPropertyChangeSetSchema.nullable().default(null),
  behaviours: DesignedBehaviourChangeSetSchema.nullable().default(null),
  rules: DesignedRuleChangeSetSchema.nullable().default(null),
  scenarios: DesignedScenarioChangeSetSchema.nullable().default(null),
});
export type DesignedBuildingBlock = z.infer<typeof DesignedBuildingBlockSchema>;

export const DesignedBuildingBlockChangeSetSchema =
  changeSetSchema(DesignedBuildingBlockSchema);

export const DesignedDomainModuleSchema = z.object({
  name: z.string(),
  description: z.string().nullable().default(null),
  buildingBlocks: DesignedBuildingBlockChangeSetSchema.nullable().default(null),
});
export type DesignedDomainModule = z.infer<typeof DesignedDomainModuleSchema>;

export const DesignedDomainModuleChangeSetSchema =
  changeSetSchema(DesignedDomainModuleSchema);

export const DesignedBoundedContextSchema = z.object({
  name: z.string(),
  description: z
    .string()
    .nullable()
    .default(null)
    .describe("Scope and responsibility of this context"),
  modules: DesignedDomainModuleChangeSetSchema.nullable().default(null),
  buildingBlocks: DesignedBuildingBlockChangeSetSchema.nullable()
    .default(null)
    .describe("Building blocks not belonging to any module"),
});
export type DesignedBoundedContext = z.infer<typeof DesignedBoundedContextSchema>;

export const DesignedActorChangeSetSchema = changeSetSchema(DesignedActorSchema);
export const DesignedBoundedContextChangeSetSchema =
  changeSetSchema(DesignedBoundedContextSchema);

export const DesignDocSchema = z.object({
  description: z
    .string()
    .describe("Summary of what this design change covers"),
  actors: DesignedActorChangeSetSchema.nullable().default(null),
  boundedContexts: DesignedBoundedContextChangeSetSchema.nullable().default(null),
});
export type DesignDoc = z.infer<typeof DesignDocSchema>;
