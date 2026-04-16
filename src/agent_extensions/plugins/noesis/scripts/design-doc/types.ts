import { z } from "zod";

export const BuildingBlockTypeSchema = z.enum([
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
export type BuildingBlockType = z.infer<typeof BuildingBlockTypeSchema>;

export const QualityAttributeTypeSchema = z.enum([
  "performance",
  "availability",
  "security",
  "other",
]);
export type QualityAttributeType = z.infer<typeof QualityAttributeTypeSchema>;

export const RuleTypeSchema = z.enum([
  "Consistency",
  "Structure",
  "Computation",
  "State change",
]);
export type RuleType = z.infer<typeof RuleTypeSchema>;

export const BehaviorTypeSchema = z.enum(["Command", "Event", "Query"]);
export type BehaviorType = z.infer<typeof BehaviorTypeSchema>;

export const PropertySchema = z.object({
  name: z.string(),
  type: z
    .string()
    .nullable()
    .default(null)
    .describe("BuildingBlock name or primitive type name"),
});
export type Property = z.infer<typeof PropertySchema>;

export const RuleSchema = z.object({
  name: z.string(),
  ruleType: RuleTypeSchema.nullable().default(null),
  description: z.string().nullable().default(null),
});
export type Rule = z.infer<typeof RuleSchema>;

export const ScenarioSchema = z.object({
  name: z.string().describe("Concise title, a few words"),
  description: z.string().describe("What the scenario verifies"),
  given: z.string().describe("Precondition or initial context"),
  when: z.string().describe("Action or event that triggers the scenario"),
  then: z.string().describe("Expected outcome or postcondition"),
});
export type Scenario = z.infer<typeof ScenarioSchema>;

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
export const PropertyChangeSetSchema = changeSetSchema(PropertySchema);
export const RuleChangeSetSchema = changeSetSchema(RuleSchema);
export const ScenarioChangeSetSchema = changeSetSchema(ScenarioSchema);

export const BehaviourSchema = z.object({
  name: z.string().describe("Concise name, a few words"),
  description: z.string().nullable().default(null),
  type: BehaviorTypeSchema.nullable().default(null),
  input: StringChangeSetSchema.nullable()
    .default(null)
    .describe("Input BuildingBlock names"),
  output: StringChangeSetSchema.nullable()
    .default(null)
    .describe("Output BuildingBlock names"),
  usedBuildingBlocks: StringChangeSetSchema.nullable()
    .default(null)
    .describe("Referenced BuildingBlock names"),
  rules: RuleChangeSetSchema.nullable().default(null),
  scenarios: ScenarioChangeSetSchema.nullable().default(null),
  isPublic: z.boolean().default(false),
  actor: z
    .string()
    .nullable()
    .default(null)
    .describe("Name of the actor who initiates this behaviour"),
});
export type Behaviour = z.infer<typeof BehaviourSchema>;

export const BehaviourChangeSetSchema = changeSetSchema(BehaviourSchema);

export const ActorSchema = z.object({
  name: z.string(),
  description: z.string().nullable().default(null),
});
export type Actor = z.infer<typeof ActorSchema>;

export const QualityAttributeSchema = z.object({
  name: z.string(),
  type: QualityAttributeTypeSchema.nullable().default(null),
  description: z
    .string()
    .nullable()
    .default(null)
    .describe("Measurable quality expectation"),
});
export type QualityAttribute = z.infer<typeof QualityAttributeSchema>;

export const BuildingBlockSchema = z.object({
  name: z.string(),
  type: BuildingBlockTypeSchema.nullable().default(null),
  description: z.string().nullable().default(null),
  properties: PropertyChangeSetSchema.nullable().default(null),
  behaviours: BehaviourChangeSetSchema.nullable().default(null),
  rules: RuleChangeSetSchema.nullable().default(null),
  scenarios: ScenarioChangeSetSchema.nullable().default(null),
});
export type BuildingBlock = z.infer<typeof BuildingBlockSchema>;

export const BuildingBlockChangeSetSchema =
  changeSetSchema(BuildingBlockSchema);

export const DomainModuleSchema = z.object({
  name: z.string(),
  description: z.string().nullable().default(null),
  buildingBlocks: BuildingBlockChangeSetSchema.nullable().default(null),
});
export type DomainModule = z.infer<typeof DomainModuleSchema>;

export const DomainModuleChangeSetSchema =
  changeSetSchema(DomainModuleSchema);

export const BoundedContextSchema = z.object({
  name: z.string(),
  description: z
    .string()
    .nullable()
    .default(null)
    .describe("Scope and responsibility of this context"),
  modules: DomainModuleChangeSetSchema.nullable().default(null),
  buildingBlocks: BuildingBlockChangeSetSchema.nullable()
    .default(null)
    .describe("Building blocks not belonging to any module"),
});
export type BoundedContext = z.infer<typeof BoundedContextSchema>;

export const ActorChangeSetSchema = changeSetSchema(ActorSchema);
export const BoundedContextChangeSetSchema =
  changeSetSchema(BoundedContextSchema);

export const DesignDocSchema = z.object({
  description: z
    .string()
    .describe("Summary of what this design change covers"),
  actors: ActorChangeSetSchema.nullable().default(null),
  boundedContexts: BoundedContextChangeSetSchema.nullable().default(null),
});
export type DesignDoc = z.infer<typeof DesignDocSchema>;
