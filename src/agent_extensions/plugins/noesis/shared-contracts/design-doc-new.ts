import { z } from "zod";
import {
  DesignedBehaviourTypeSchema,
  DesignedBuildingBlockTypeSchema,
  DesignedQualityAttributeTypeSchema,
  DesignedRuleTypeSchema,
} from "./design-doc.js";

const lockedBool = () => z.boolean().default(false);

export const DesignedActorNewSchema = z.object({
  name: z.string(),
  name_locked: lockedBool(),
  description: z.string().nullable().default(null),
  description_locked: lockedBool(),
});
export type DesignedActorNew = z.infer<typeof DesignedActorNewSchema>;

export const DesignedPropertyNewSchema = z.object({
  name: z.string(),
  name_locked: lockedBool(),
  type: z.string().nullable().default(null),
  type_locked: lockedBool(),
  description: z.string().nullable().default(null),
  description_locked: lockedBool(),
  nullable: z.boolean().optional(),
  collection: z.boolean().optional(),
});
export type DesignedPropertyNew = z.infer<typeof DesignedPropertyNewSchema>;

export const DesignedRuleNewSchema = z.object({
  name: z.string(),
  name_locked: lockedBool(),
  ruleType: DesignedRuleTypeSchema.nullable().default(null),
  description: z.string().nullable().default(null),
  description_locked: lockedBool(),
});
export type DesignedRuleNew = z.infer<typeof DesignedRuleNewSchema>;

export const DesignedScenarioNewSchema = z.object({
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
export type DesignedScenarioNew = z.infer<typeof DesignedScenarioNewSchema>;

export const DesignedQualityAttributeNewSchema = z.object({
  name: z.string(),
  name_locked: lockedBool(),
  type: DesignedQualityAttributeTypeSchema.nullable().default(null),
  description: z.string().nullable().default(null),
  description_locked: lockedBool(),
});
export type DesignedQualityAttributeNew = z.infer<
  typeof DesignedQualityAttributeNewSchema
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

export const DesignedPropertyChangeSetNewSchema = changeSetSchema(
  DesignedPropertyNewSchema,
);
export type DesignedPropertyChangeSetNew = z.infer<
  typeof DesignedPropertyChangeSetNewSchema
>;

export const DesignedRuleChangeSetNewSchema = changeSetSchema(
  DesignedRuleNewSchema,
);
export type DesignedRuleChangeSetNew = z.infer<
  typeof DesignedRuleChangeSetNewSchema
>;

export const DesignedScenarioChangeSetNewSchema = changeSetSchema(
  DesignedScenarioNewSchema,
);
export type DesignedScenarioChangeSetNew = z.infer<
  typeof DesignedScenarioChangeSetNewSchema
>;

export const DesignedQualityAttributeChangeSetNewSchema = changeSetSchema(
  DesignedQualityAttributeNewSchema,
);
export type DesignedQualityAttributeChangeSetNew = z.infer<
  typeof DesignedQualityAttributeChangeSetNewSchema
>;

export const DesignedBehaviourNewSchema = z.object({
  name: z.string(),
  name_locked: lockedBool(),
  description: z.string().nullable().default(null),
  description_locked: lockedBool(),
  type: DesignedBehaviourTypeSchema.nullable().default(null),
  type_locked: lockedBool(),
  input: StringChangeSetSchema.optional(),
  output: StringChangeSetSchema.optional(),
  usedBuildingBlocks: StringChangeSetSchema.optional(),
  rules: DesignedRuleChangeSetNewSchema.optional(),
  scenarios: DesignedScenarioChangeSetNewSchema.optional(),
  qualityAttributes: DesignedQualityAttributeChangeSetNewSchema.optional(),
  isPublic: z.boolean().default(false),
  actor: z.string().nullable().default(null),
  actor_locked: lockedBool(),
});
export type DesignedBehaviourNew = z.infer<typeof DesignedBehaviourNewSchema>;

export const DesignedBehaviourChangeSetNewSchema = changeSetSchema(
  DesignedBehaviourNewSchema,
);
export type DesignedBehaviourChangeSetNew = z.infer<
  typeof DesignedBehaviourChangeSetNewSchema
>;

export const DesignedBuildingBlockNewSchema = z.object({
  name: z.string(),
  name_locked: lockedBool(),
  type: DesignedBuildingBlockTypeSchema.nullable().default(null),
  type_locked: lockedBool(),
  description: z.string().nullable().default(null),
  description_locked: lockedBool(),
  implements: z.array(z.string()).optional(),
  properties: DesignedPropertyChangeSetNewSchema.optional(),
  behaviours: DesignedBehaviourChangeSetNewSchema.optional(),
  rules: DesignedRuleChangeSetNewSchema.optional(),
  scenarios: DesignedScenarioChangeSetNewSchema.optional(),
  qualityAttributes: DesignedQualityAttributeChangeSetNewSchema.optional(),
});
export type DesignedBuildingBlockNew = z.infer<
  typeof DesignedBuildingBlockNewSchema
>;

export const DesignedBuildingBlockChangeSetNewSchema = changeSetSchema(
  DesignedBuildingBlockNewSchema,
);
export type DesignedBuildingBlockChangeSetNew = z.infer<
  typeof DesignedBuildingBlockChangeSetNewSchema
>;

export const DesignedDomainModuleNewSchema = z.object({
  name: z.string(),
  name_locked: lockedBool(),
  description: z.string().nullable().default(null),
  description_locked: lockedBool(),
  buildingBlocks: DesignedBuildingBlockChangeSetNewSchema.optional(),
  qualityAttributes: DesignedQualityAttributeChangeSetNewSchema.optional(),
});
export type DesignedDomainModuleNew = z.infer<
  typeof DesignedDomainModuleNewSchema
>;

export const DesignedDomainModuleChangeSetNewSchema = changeSetSchema(
  DesignedDomainModuleNewSchema,
);
export type DesignedDomainModuleChangeSetNew = z.infer<
  typeof DesignedDomainModuleChangeSetNewSchema
>;

export const DesignedBoundedContextNewSchema = z.object({
  name: z.string(),
  name_locked: lockedBool(),
  description: z.string().nullable().default(null),
  description_locked: lockedBool(),
  modules: DesignedDomainModuleChangeSetNewSchema.optional(),
  buildingBlocks: DesignedBuildingBlockChangeSetNewSchema.optional(),
  qualityAttributes: DesignedQualityAttributeChangeSetNewSchema.optional(),
});
export type DesignedBoundedContextNew = z.infer<
  typeof DesignedBoundedContextNewSchema
>;

export const DesignedBoundedContextChangeSetNewSchema = changeSetSchema(
  DesignedBoundedContextNewSchema,
);
export type DesignedBoundedContextChangeSetNew = z.infer<
  typeof DesignedBoundedContextChangeSetNewSchema
>;

export const DesignDocFileNewSchema = z.object({
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
  actors: z.array(DesignedActorNewSchema).default([]),
  boundedContexts: DesignedBoundedContextChangeSetNewSchema.optional(),
  implemented: z.boolean().default(false),
});
export type DesignDocFileNew = z.infer<typeof DesignDocFileNewSchema>;
