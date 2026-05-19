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

const lockedBool = () => z.boolean().default(false);

export const DesignedActorSchema = z.object({
  name: z.string(),
  name_locked: lockedBool(),
  description: z.string().nullable().default(null),
  description_locked: lockedBool(),
});
export type DesignedActor = z.infer<typeof DesignedActorSchema>;

export const DesignedPropertySchema = z.object({
  name: z.string(),
  name_locked: lockedBool(),
  type: z.string().nullable().default(null),
  type_locked: lockedBool(),
  description: z.string().nullable().default(null),
  description_locked: lockedBool(),
  nullable: z.boolean().optional(),
  collection: z.boolean().optional(),
});
export type DesignedProperty = z.infer<typeof DesignedPropertySchema>;

export const DesignedRuleSchema = z.object({
  name: z.string(),
  name_locked: lockedBool(),
  ruleType: DesignedRuleTypeSchema.nullable().default(null),
  description: z.string().nullable().default(null),
  description_locked: lockedBool(),
});
export type DesignedRule = z.infer<typeof DesignedRuleSchema>;

export const DesignedScenarioSchema = z.object({
  name: z.string(),
  name_locked: lockedBool(),
  description: z.string(),
  description_locked: lockedBool(),
  given: z.string(),
  given_locked: lockedBool(),
  when: z.string(),
  when_locked: lockedBool(),
  then: z.string(),
  then_locked: lockedBool(),
});
export type DesignedScenario = z.infer<typeof DesignedScenarioSchema>;

export const DesignedQualityAttributeSchema = z.object({
  name: z.string(),
  name_locked: lockedBool(),
  type: DesignedQualityAttributeTypeSchema.nullable().default(null),
  description: z.string().nullable().default(null),
  description_locked: lockedBool(),
});
export type DesignedQualityAttribute = z.infer<
  typeof DesignedQualityAttributeSchema
>;

function changeSetSchema<T extends z.ZodTypeAny>(itemSchema: T) {
  return z.object({
    added: z.array(itemSchema).default([]),
    removed: z.array(z.string()).default([]),
    modified: z.array(itemSchema).default([]),
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
  name: z.string(),
  name_locked: lockedBool(),
  description: z.string().nullable().default(null),
  description_locked: lockedBool(),
  type: DesignedBehaviourTypeSchema.nullable().default(null),
  type_locked: lockedBool(),
  input: StringChangeSetSchema.optional(),
  output: StringChangeSetSchema.optional(),
  usedBuildingBlocks: StringChangeSetSchema.optional(),
  rules: DesignedRuleChangeSetSchema.optional(),
  scenarios: DesignedScenarioChangeSetSchema.optional(),
  qualityAttributes: DesignedQualityAttributeChangeSetSchema.optional(),
  isPublic: z.boolean().default(false),
  actor: z.string().nullable().default(null),
  actor_locked: lockedBool(),
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
  name_locked: lockedBool(),
  type: DesignedBuildingBlockTypeSchema.nullable().default(null),
  type_locked: lockedBool(),
  description: z.string().nullable().default(null),
  description_locked: lockedBool(),
  implements: z.array(z.string()).optional(),
  properties: DesignedPropertyChangeSetSchema.optional(),
  behaviours: DesignedBehaviourChangeSetSchema.optional(),
  rules: DesignedRuleChangeSetSchema.optional(),
  scenarios: DesignedScenarioChangeSetSchema.optional(),
  qualityAttributes: DesignedQualityAttributeChangeSetSchema.optional(),
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
  name_locked: lockedBool(),
  description: z.string().nullable().default(null),
  description_locked: lockedBool(),
  buildingBlocks: DesignedBuildingBlockChangeSetSchema.optional(),
  qualityAttributes: DesignedQualityAttributeChangeSetSchema.optional(),
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
  name_locked: lockedBool(),
  description: z.string().nullable().default(null),
  description_locked: lockedBool(),
  modules: DesignedDomainModuleChangeSetSchema.optional(),
  buildingBlocks: DesignedBuildingBlockChangeSetSchema.optional(),
  qualityAttributes: DesignedQualityAttributeChangeSetSchema.optional(),
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

export const DesignDocFileSchema = z.object({
  id: z.string(),
  name: z.string(),
  name_locked: lockedBool(),
  description: z.string(),
  description_locked: lockedBool(),
  // ISO date (YYYY-MM-DD) when the doc was authored. Drives ordering on the
  // design-docs page. Defaulted to today on parse so legacy fixtures and skills
  // that don't supply it stay valid.
  date: z
    .string()
    .default(() => new Date().toISOString().slice(0, 10)),
  actors: z.array(DesignedActorSchema).default([]),
  boundedContexts: DesignedBoundedContextChangeSetSchema.optional(),
  implemented: z.boolean().default(false),
});
export type DesignDocFile = z.infer<typeof DesignDocFileSchema>;
