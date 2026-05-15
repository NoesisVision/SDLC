import { mkdirSync, writeFileSync } from "fs";
import { Logger } from "@nestjs/common";
import type {
  DesignDocFileNew,
  DesignedActorNew,
  DesignedBehaviourNew,
  DesignedBoundedContextNew,
  DesignedBuildingBlockNew,
  DesignedDomainModuleNew,
  DesignedPropertyNew,
  DesignedQualityAttributeNew,
  DesignedRuleNew,
  DesignedScenarioNew,
  StringChangeSet,
} from "../../../shared-contracts/design-doc-new.js";
import {
  ConversationSchema,
  type Conversation,
} from "../../../shared-contracts/conversation.js";
import {
  DecisionFileNewSchema,
  DocumentFileNewSchema,
  TopicFileNewSchema,
  type DecisionFileNew,
  type DocumentFileNew,
  type TopicFileNew,
} from "../../../shared-contracts/source-file-schemas.js";
import {
  conversationJsonPath,
  decisionJsonPath,
  designDocCanonicalPath,
  documentJsonPath,
  topicJsonPath,
} from "../../../shared-contracts/source-files.js";
import { IndexerService } from "../indexer/indexer.service.js";

/**
 * Writes a curated set of conversation, document, topic, decision and design-doc
 * files to `<projectDir>/noesis/`, then triggers a full re-index so the dev UI
 * has data to render.
 *
 * Coverage rule (mirrored in the noesis CLAUDE.md): every optional / nullable
 * field on the file-first models gets at least one fixture item with that field
 * set to null or omitted, and at least one with the field populated. Indexers
 * and UI views must cope with both shapes.
 */
export async function seedDevDatabase(
  projectDir: string,
  indexer: IndexerService,
): Promise<void> {
  const logger = new Logger("DevSeed");

  for (const conversation of seedConversations()) {
    writeConversation(projectDir, conversation);
  }
  for (const document of seedDocuments()) {
    writeDocument(projectDir, document);
  }
  for (const topic of seedTopics()) {
    writeTopic(projectDir, topic);
  }
  for (const decision of seedDecisions()) {
    writeDecision(projectDir, decision);
  }
  for (const doc of seedDesignDocs()) {
    writeDesignDoc(projectDir, doc);
  }

  const result = await indexer.runFullIndex();
  logger.log(
    `Seeded fixtures: ${result.files_processed}/${result.files_total} files indexed ` +
      `(${result.stale_topics} stale topics, ${result.stale_decisions} stale decisions)`,
  );
}

// ---------- conversations ----------

function seedConversations(): Conversation[] {
  return [
    ConversationSchema.parse({
      conversation_id: "conv-kickoff",
      time: "2026-02-04T10:00:00Z",
      main_topic: "Auth strategy kickoff",
      turns: [
        {
          index: 0,
          speaker: "Alice",
          time: "2026-02-04T10:00:00Z",
          idea_units: [
            {
              index: 0,
              sentences: ["We need passwordless login as the default."],
              categories: ["Position"],
            },
            {
              index: 1,
              sentences: ["The mobile team requested support for SSO too."],
              categories: ["Information"],
            },
            {
              index: 2,
              sentences: ["Let's not get distracted by the QA tooling."],
              categories: ["Irrelevant"],
            },
          ],
        },
        {
          index: 1,
          speaker: "Bob",
          time: "2026-02-04T10:05:00Z",
          idea_units: [
            {
              index: 0,
              sentences: [
                "OAuth2 with PKCE feels like the right default.",
                "It plays well with both web and mobile.",
              ],
              categories: ["Argument"],
            },
            {
              index: 1,
              sentences: ["Decision: we go with OAuth2 PKCE."],
              categories: ["Decision"],
            },
          ],
        },
      ],
    }),
    ConversationSchema.parse({
      conversation_id: "conv-followup",
      time: "2026-03-12T14:30:00Z",
      main_topic: "Auth follow-up",
      turns: [
        {
          index: 0,
          speaker: "Alice",
          time: "2026-03-12T14:30:00Z",
          idea_units: [
            {
              index: 0,
              sentences: ["Are we revisiting the OAuth provider choice?"],
              categories: ["Position"],
            },
            {
              index: 1,
              sentences: ["No, the constraints from last quarter still hold."],
              categories: ["Argument"],
            },
          ],
        },
      ],
    }),
  ];
}

// ---------- documents ----------

function seedDocuments(): DocumentFileNew[] {
  const visionContent = [
    "Auth Vision\n",
    "Passwordless is the default; SSO is a follow-up.",
  ].join("\n");
  return [
    DocumentFileNewSchema.parse({
      document_id: "doc-vision",
      title: "Auth vision",
      date: "2026-01-20",
      content: visionContent,
      fragments: [
        {
          index: 0,
          start_offset: 0,
          end_offset: 11,
          section_path: ["Auth Vision"],
          kind: "paragraph",
          text: "Auth Vision",
          categories: ["Information"],
        },
        {
          index: 1,
          start_offset: 13,
          end_offset: visionContent.length,
          section_path: ["Auth Vision"],
          kind: "paragraph",
          text: "Passwordless is the default; SSO is a follow-up.",
          categories: ["Position"],
        },
      ],
      section_tree: [
        {
          level: 1,
          title: "Auth Vision",
          path: ["Auth Vision"],
          fragment_indices: [0, 1],
          children: [],
        },
      ],
    }),
    DocumentFileNewSchema.parse({
      document_id: "doc-checkout-rfc",
      title: "Checkout RFC",
      date: "2026-02-15",
      content: "Checkout RFC: cart, totals, payment.",
      fragments: [
        {
          index: 0,
          start_offset: 0,
          end_offset: 36,
          section_path: ["Checkout RFC"],
          kind: "paragraph",
          text: "Checkout RFC: cart, totals, payment.",
          categories: ["Information"],
        },
      ],
      section_tree: [
        {
          level: 1,
          title: "Checkout RFC",
          path: ["Checkout RFC"],
          fragment_indices: [0],
          children: [],
        },
      ],
    }),
  ];
}

// ---------- topics ----------

function seedTopics(): TopicFileNew[] {
  // parent_id = null: covered by "topic-auth" and "topic-checkout" (root topics).
  // parent_id != null: covered by "topic-auth-mobile" (child of "topic-auth").
  return [
    TopicFileNewSchema.parse({
      id: "topic-auth",
      parent_id: null,
      title: "Authentication",
      short_summary: "Sign-in, sign-up, session lifecycle.",
      long_summary:
        "Covers passwordless login, SSO, and session management for web and mobile clients.",
      items: [
        {
          type: "idea_unit_ref",
          conversation_id: "conv-kickoff",
          turn_index: 0,
          idea_unit_index: 0,
        },
        {
          type: "idea_unit_ref",
          conversation_id: "conv-kickoff",
          turn_index: 0,
          idea_unit_index: 1,
        },
        {
          type: "idea_unit_ref",
          conversation_id: "conv-kickoff",
          turn_index: 1,
          idea_unit_index: 0,
        },
        {
          type: "idea_unit_ref",
          conversation_id: "conv-followup",
          turn_index: 0,
          idea_unit_index: 1,
        },
        {
          type: "document_fragment_ref",
          document_id: "doc-vision",
          start_offset: 13,
          end_offset: visionContentLength(),
        },
      ],
      reviewed: true,
      decisions_extracted: true,
    }),
    TopicFileNewSchema.parse({
      id: "topic-auth-mobile",
      parent_id: "topic-auth",
      title: "Mobile auth",
      short_summary: "Mobile-specific auth concerns.",
      long_summary: "PKCE, biometric prompts, refresh handling.",
      items: [
        {
          type: "idea_unit_ref",
          conversation_id: "conv-kickoff",
          turn_index: 1,
          idea_unit_index: 0,
        },
      ],
      reviewed: true,
      decisions_extracted: false,
    }),
    TopicFileNewSchema.parse({
      id: "topic-checkout",
      parent_id: null,
      title: "Checkout",
      short_summary: "Cart and order completion.",
      long_summary: "Covers cart state, totals, payment hand-off.",
      items: [
        {
          type: "document_fragment_ref",
          document_id: "doc-checkout-rfc",
          start_offset: 0,
          end_offset: 36,
        },
      ],
      reviewed: true,
      decisions_extracted: false,
    }),
  ];
}

function visionContentLength(): number {
  return ["Auth Vision\n", "Passwordless is the default; SSO is a follow-up."]
    .join("\n").length;
}

// ---------- decisions ----------

function seedDecisions(): DecisionFileNew[] {
  return [
    DecisionFileNewSchema.parse({
      id: "decision-oauth2",
      topic_id: "topic-auth",
      title: "Adopt OAuth2 with PKCE",
      status: "accepted",
      referenced_items: [
        {
          type: "idea_unit_ref",
          conversation_id: "conv-kickoff",
          turn_index: 1,
          idea_unit_index: 0,
        },
        {
          type: "idea_unit_ref",
          conversation_id: "conv-kickoff",
          turn_index: 1,
          idea_unit_index: 1,
        },
        {
          type: "document_fragment_ref",
          document_id: "doc-vision",
          start_offset: 13,
          end_offset: visionContentLength(),
        },
      ],
      context: {
        text:
          "We need a unified auth protocol that works for web and mobile, and " +
          "supports SSO follow-on work without redesign.",
        supporting_item_indices: [2],
      },
      decision: {
        text: "Use OAuth2 with PKCE for all first-party clients.",
        rationale:
          "PKCE handles native clients safely; PKCE + OAuth2 is the industry default and unblocks SSO.",
        supporting_item_indices: [0, 1],
      },
      alternative_options: [
        {
          text: "Custom session cookies + CSRF tokens.",
          rationale:
            "Simpler to bootstrap but doesn't generalise to mobile or third-party SSO.",
          supporting_item_indices: [0],
        },
      ],
    }),
    // Second decision exercises empty alternative_options + minimal supporting indices.
    DecisionFileNewSchema.parse({
      id: "decision-no-vendor-lock",
      topic_id: "topic-auth",
      title: "No vendor-lock for the IdP",
      status: "proposed",
      referenced_items: [
        {
          type: "idea_unit_ref",
          conversation_id: "conv-followup",
          turn_index: 0,
          idea_unit_index: 1,
        },
      ],
      context: {
        text: "We may revisit IdP later; keep the abstraction provider-neutral.",
        supporting_item_indices: [0],
      },
      decision: {
        text: "Wrap the IdP behind an internal interface; no SDK leaks into app code.",
        rationale: "Lets us swap IdP without touching application services.",
        supporting_item_indices: [0],
      },
      alternative_options: [],
    }),
  ];
}

// ---------- design docs ----------

function seedDesignDocs(): DesignDocFileNew[] {
  return [greenfieldDesignDoc(), tierExpansionDesignDoc(), draftDesignDoc()];
}

/**
 * Greenfield doc: covers every optional/nullable field with both a populated
 * variant and a null-or-missing variant. ChangeSets only exercise `added`,
 * which is the contract for green-field docs.
 *
 * Two bounded contexts are deliberately shaped as polar opposites:
 *
 *   - "Sales"      — fully populated: description set, modules + buildingBlocks
 *                    + qualityAttributes all present, every nested entity has
 *                    its optional fields populated.
 *   - "Reporting"  — minimal: description null, modules/buildingBlocks/
 *                    qualityAttributes all omitted.
 */
function greenfieldDesignDoc(): DesignDocFileNew {
  return {
    id: "ddoc-sales-platform",
    name: "Sales platform",
    name_locked: false,
    description: "Greenfield design for the sales platform.",
    description_locked: false,
    date: "2026-01-25",
    actors: [actorRich(), actorMinimal()],
    boundedContexts: {
      added: [salesBoundedContext(), reportingBoundedContext()],
      modified: [],
      removed: [],
    },
    implemented: false,
  };
}

/**
 * Tier-expansion doc: a follow-up evolution of the Sales platform that
 * demonstrates the full ChangeSet shape (`added` + `modified` + `removed`) at
 * every nesting level — bounded contexts, modules, building blocks, behaviours,
 * rules, scenarios, quality attributes, properties, and the string change-sets
 * on behaviours (input, output, usedBuildingBlocks). This is the fixture that
 * exercises modify and remove rendering paths in the UI.
 */
function tierExpansionDesignDoc(): DesignDocFileNew {
  return {
    id: "ddoc-sales-tier-expansion",
    name: "Sales platform: tier expansion",
    name_locked: false,
    description:
      "Follow-up to the Sales platform doc — introduces customer tiers, " +
      "reshapes pricing, and retires the placeholder modules.",
    description_locked: false,
    date: "2026-04-20",
    actors: [actorRich()],
    boundedContexts: {
      added: [catalogBoundedContext()],
      modified: [salesBoundedContextDiff()],
      removed: ["Reporting"],
    },
    implemented: false,
  };
}

/** Covers DesignDocFileNew.boundedContexts being undefined. */
function draftDesignDoc(): DesignDocFileNew {
  return {
    id: "ddoc-onboarding-draft",
    name: "Onboarding draft",
    name_locked: false,
    description: "Stub doc — bounded contexts not yet sketched.",
    description_locked: false,
    date: "2026-02-10",
    actors: [],
    implemented: false,
  };
}

// ----- tier-expansion building blocks (added/modified/removed at every level) -----

/** New bounded context introduced by the v2 doc. */
function catalogBoundedContext(): DesignedBoundedContextNew {
  return {
    name: "Catalog",
    name_locked: false,
    description: "Product browsing and tier-aware listings.",
    description_locked: false,
    modules: {
      added: [
        {
          name: "Browse",
          name_locked: false,
          description: "Tier-filtered product views.",
          description_locked: false,
        },
      ],
      modified: [],
      removed: [],
    },
  };
}

/**
 * Modified shape of the existing "Sales" bounded context. Demonstrates each
 * inner change-set populating all three slots: added/modified/removed.
 */
function salesBoundedContextDiff(): DesignedBoundedContextNew {
  return {
    name: "Sales",
    name_locked: false,
    description: "Order capture, tier-aware pricing, fulfilment hand-off.",
    description_locked: false,
    modules: {
      added: [
        {
          name: "Promotions",
          name_locked: false,
          description: "Time-bound tier promotions.",
          description_locked: false,
        },
      ],
      modified: [pricingModuleDiff()],
      removed: ["Fulfilment"],
    },
  };
}

/** Modified shape of the existing "Pricing" module. */
function pricingModuleDiff(): DesignedDomainModuleNew {
  return {
    name: "Pricing",
    name_locked: false,
    description:
      "Discount rules, list prices, currency conversion, customer-tier overrides.",
    description_locked: false,
    buildingBlocks: {
      added: [
        {
          name: "DiscountChain",
          name_locked: false,
          type: "domain_service",
          type_locked: false,
          description: "Composes discount rules in priority order.",
          description_locked: false,
        },
      ],
      modified: [priceCalculatorBuildingBlockDiff()],
      removed: ["Money"],
    },
  };
}

/**
 * Modified shape of "PriceCalculator". Every inner ChangeSet (properties,
 * behaviours, rules, scenarios, qualityAttributes) populates all three slots,
 * and `implements` shows the array-update shape.
 */
function priceCalculatorBuildingBlockDiff(): DesignedBuildingBlockNew {
  return {
    name: "PriceCalculator",
    name_locked: false,
    type: "domain_service",
    type_locked: false,
    description:
      "Computes tier-aware order totals from cart items and the active discount chain.",
    description_locked: false,
    implements: ["IPricingPort", "ITierAware"],
    properties: {
      added: [
        {
          name: "currentTier",
          name_locked: false,
          type: "TierLevel",
          type_locked: false,
          description: "Tier in effect at calculation time.",
          description_locked: false,
          nullable: false,
          collection: false,
        },
      ],
      modified: [
        {
          name: "rules",
          name_locked: false,
          type: "DiscountRule",
          type_locked: false,
          description:
            "Active discount rules, ordered by priority and tier compatibility.",
          description_locked: false,
          nullable: false,
          collection: true,
        },
      ],
      removed: ["lastBackfilledAt"],
    },
    behaviours: {
      added: [
        {
          name: "recalculateForTier",
          name_locked: false,
          description:
            "Input: an existing OrderTotals plus a TierLevel. Validation: tier known. " +
            "Steps: 1. Reapply chain with new tier weight. 2. Diff totals. " +
            "Output: OrderTotals reflecting the tier change.",
          description_locked: false,
          type: "Command",
          type_locked: false,
          input: changeSet(["TierLevel"]),
          output: changeSet(["OrderTotals"]),
          usedBuildingBlocks: changeSet(["DiscountChain", "TierLookup"]),
          rules: { added: [ruleRich()], modified: [], removed: [] },
          scenarios: { added: [scenarioRich()], modified: [], removed: [] },
          qualityAttributes: {
            added: [qualityAttributeRich()],
            modified: [],
            removed: [],
          },
          isPublic: true,
          actor: "Customer",
          actor_locked: false,
        },
      ],
      modified: [calculateBehaviourDiff()],
      removed: ["warmCache"],
    },
    rules: {
      added: [
        {
          name: "tier-applied-once",
          name_locked: false,
          ruleType: "Computation",
          description:
            "A tier override must be applied exactly once per calculation pass.",
          description_locked: false,
        },
      ],
      modified: [
        {
          name: "priorities-are-unique",
          name_locked: false,
          ruleType: "Structure",
          description:
            "Two active rules cannot share the same priority value within a tier.",
          description_locked: false,
        },
      ],
      removed: ["tbd-rule"],
    },
    scenarios: {
      added: [
        {
          name: "recalculates after tier change",
          name_locked: false,
          description:
            "When a customer is promoted mid-session, totals reflect the new tier on next calculate.",
          description_locked: false,
          given: "an OrderTotals computed at tier Bronze",
          given_locked: false,
          when: "recalculateForTier is invoked with TierLevel=Gold",
          when_locked: false,
          then: "totals reflect the Gold tier discounts",
          then_locked: false,
        },
      ],
      modified: [
        {
          name: "applies the highest-priority discount first",
          name_locked: false,
          description:
            "When two discounts apply within the active tier, the lower priority number wins.",
          description_locked: false,
          given:
            "a cart with two applicable discounts at priorities 1 and 5 within the active tier",
          given_locked: false,
          when: "calculate is invoked",
          when_locked: false,
          then:
            "the priority-1 discount is applied first and totals reflect it",
          then_locked: false,
        },
      ],
      removed: ["legacy-flat-discount"],
    },
    qualityAttributes: {
      added: [
        {
          name: "tier-cache-hit-rate",
          name_locked: false,
          type: "performance",
          description:
            "Tier lookup cache must keep ≥95% hit rate at p99 latency budget.",
          description_locked: false,
        },
      ],
      modified: [
        {
          name: "p99-under-100ms",
          name_locked: false,
          type: "performance",
          description:
            "p99 latency for calculate must stay under 100ms at 200 RPS, including tier lookup.",
          description_locked: false,
        },
      ],
      removed: ["tbd-quality"],
    },
  };
}

/**
 * Modified shape of "calculate". Each StringChangeSet (input, output,
 * usedBuildingBlocks) populates all three slots, and rules / scenarios /
 * qualityAttributes do too.
 */
function calculateBehaviourDiff(): DesignedBehaviourNew {
  return {
    name: "calculate",
    name_locked: false,
    description:
      "Input: cart with line items, customer id, and active TierLevel. " +
      "Validation: line items non-empty, tier resolvable. " +
      "Steps: 1. Resolve tier. 2. Apply rule chain in priority order. " +
      "3. Round to currency precision. Output: OrderTotals broken down by line.",
    description_locked: false,
    type: "Command",
    type_locked: false,
    input: {
      added: ["TierLevel"],
      modified: ["Cart"],
      removed: ["LegacyCustomer"],
    },
    output: {
      added: ["OrderTotals"],
      modified: ["LineBreakdown"],
      removed: ["DeprecatedSummary"],
    },
    usedBuildingBlocks: {
      added: ["DiscountChain", "TierLookup"],
      modified: ["DiscountRule"],
      removed: ["LegacyDiscountHelper"],
    },
    rules: {
      added: [
        {
          name: "tier-applied-once",
          name_locked: false,
          ruleType: "Computation",
          description:
            "A tier override must be applied exactly once per calculation pass.",
          description_locked: false,
        },
      ],
      modified: [
        {
          name: "priorities-are-unique",
          name_locked: false,
          ruleType: "Structure",
          description:
            "Two active rules cannot share the same priority value within a tier.",
          description_locked: false,
        },
      ],
      removed: ["legacy-rounding"],
    },
    scenarios: {
      added: [
        {
          name: "applies the active tier override",
          name_locked: false,
          description: "Tier override is applied to the resolved chain.",
          description_locked: false,
          given: "a Gold-tier customer with two applicable discounts",
          given_locked: false,
          when: "calculate is invoked",
          when_locked: false,
          then: "the Gold-tier override price is used",
          then_locked: false,
        },
      ],
      modified: [
        {
          name: "applies the highest-priority discount first",
          name_locked: false,
          description:
            "When two discounts apply within the active tier, the lower priority number wins.",
          description_locked: false,
          given:
            "a cart with two applicable discounts at priorities 1 and 5 within the active tier",
          given_locked: false,
          when: "calculate is invoked",
          when_locked: false,
          then:
            "the priority-1 discount is applied first and totals reflect it",
          then_locked: false,
        },
      ],
      removed: ["legacy-no-discount"],
    },
    qualityAttributes: {
      added: [
        {
          name: "tier-cache-hit-rate",
          name_locked: false,
          type: "performance",
          description:
            "Tier lookup cache must keep ≥95% hit rate at p99 latency budget.",
          description_locked: false,
        },
      ],
      modified: [
        {
          name: "p99-under-100ms",
          name_locked: false,
          type: "performance",
          description:
            "p99 latency for calculate must stay under 100ms at 200 RPS, including tier lookup.",
          description_locked: false,
        },
      ],
      removed: ["legacy-throughput-budget"],
    },
    isPublic: true,
    actor: "Customer",
    actor_locked: false,
  };
}

function actorRich(): DesignedActorNew {
  return {
    name: "Customer",
    name_locked: false,
    description: "End user paying for the service.",
    description_locked: false,
  };
}

/** Covers DesignedActorNew.description = null. */
function actorMinimal(): DesignedActorNew {
  return {
    name: "Operator",
    name_locked: false,
    description: null,
    description_locked: false,
  };
}

function salesBoundedContext(): DesignedBoundedContextNew {
  return {
    name: "Sales",
    name_locked: false,
    description: "Order capture, pricing, fulfilment hand-off.",
    description_locked: false,
    modules: {
      added: [pricingModuleRich(), fulfilmentModuleMinimal()],
      modified: [],
      removed: [],
    },
    buildingBlocks: {
      added: [bcLevelBuildingBlock()],
      modified: [],
      removed: [],
    },
    qualityAttributes: {
      added: [qualityAttributeRich(), qualityAttributeMinimal()],
      modified: [],
      removed: [],
    },
  };
}

/**
 * Covers: BoundedContext.description = null and
 * modules/buildingBlocks/qualityAttributes all omitted.
 */
function reportingBoundedContext(): DesignedBoundedContextNew {
  return {
    name: "Reporting",
    name_locked: false,
    description: null,
    description_locked: false,
  };
}

function pricingModuleRich(): DesignedDomainModuleNew {
  return {
    name: "Pricing",
    name_locked: false,
    description: "Discount rules, list prices, currency conversion.",
    description_locked: false,
    buildingBlocks: {
      added: [priceCalculatorBuildingBlock(), valueObjectBuildingBlock()],
      modified: [],
      removed: [],
    },
    qualityAttributes: {
      added: [qualityAttributeRich()],
      modified: [],
      removed: [],
    },
  };
}

/**
 * Covers: DomainModule.description = null and
 * buildingBlocks/qualityAttributes both omitted.
 */
function fulfilmentModuleMinimal(): DesignedDomainModuleNew {
  return {
    name: "Fulfilment",
    name_locked: false,
    description: null,
    description_locked: false,
  };
}

/**
 * BC-level building block. Covers BuildingBlock.{type, description} = null and
 * implements/properties/behaviours/rules/scenarios/qualityAttributes all omitted.
 */
function bcLevelBuildingBlock(): DesignedBuildingBlockNew {
  return {
    name: "OrderId",
    name_locked: false,
    type: null,
    type_locked: false,
    description: null,
    description_locked: false,
  };
}

function priceCalculatorBuildingBlock(): DesignedBuildingBlockNew {
  return {
    name: "PriceCalculator",
    name_locked: false,
    type: "domain_service",
    type_locked: false,
    description: "Computes order totals from cart items and active discounts.",
    description_locked: false,
    implements: ["IPricingPort"],
    properties: {
      added: [propertyRich(), propertyMinimal()],
      modified: [],
      removed: [],
    },
    behaviours: {
      added: [behaviourRich(), behaviourMinimal()],
      modified: [],
      removed: [],
    },
    rules: {
      added: [ruleRich(), ruleMinimal()],
      modified: [],
      removed: [],
    },
    scenarios: {
      added: [scenarioRich()],
      modified: [],
      removed: [],
    },
    qualityAttributes: {
      added: [qualityAttributeRich()],
      modified: [],
      removed: [],
    },
  };
}

/**
 * Covers BuildingBlock with type/description set but every other optional
 * (implements, properties, behaviours, rules, scenarios, qualityAttributes)
 * intentionally omitted.
 */
function valueObjectBuildingBlock(): DesignedBuildingBlockNew {
  return {
    name: "Money",
    name_locked: false,
    type: "value_object",
    type_locked: false,
    description: "Amount + currency code, immutable.",
    description_locked: false,
  };
}

function propertyRich(): DesignedPropertyNew {
  return {
    name: "rules",
    name_locked: false,
    type: "DiscountRule",
    type_locked: false,
    description: "Active discount rules, ordered by priority.",
    description_locked: false,
    nullable: false,
    collection: true,
  };
}

/**
 * Covers Property.{type, description} = null and nullable/collection both
 * omitted (so consumers must treat them as undefined, not false).
 */
function propertyMinimal(): DesignedPropertyNew {
  return {
    name: "lastBackfilledAt",
    name_locked: false,
    type: null,
    type_locked: false,
    description: null,
    description_locked: false,
  };
}

function behaviourRich(): DesignedBehaviourNew {
  return {
    name: "calculate",
    name_locked: false,
    description:
      "Input: cart with line items and customer id. Validation: line items non-empty. " +
      "Steps: 1. Fetch customer tier. 2. Apply rule chain in priority order. " +
      "3. Round to currency precision. Output: totals broken down by line.",
    description_locked: false,
    type: "Command",
    type_locked: false,
    input: changeSet(["Cart", "CustomerId"]),
    output: changeSet(["OrderTotals"]),
    usedBuildingBlocks: changeSet(["DiscountRule", "Money"]),
    rules: { added: [ruleRich()], modified: [], removed: [] },
    scenarios: { added: [scenarioRich()], modified: [], removed: [] },
    qualityAttributes: {
      added: [qualityAttributeRich()],
      modified: [],
      removed: [],
    },
    isPublic: true,
    actor: "Customer",
    actor_locked: false,
  };
}

/**
 * Covers Behaviour.{description, type} = null, actor = null, and every
 * optional collection (input, output, usedBuildingBlocks, rules, scenarios,
 * qualityAttributes) omitted.
 */
function behaviourMinimal(): DesignedBehaviourNew {
  return {
    name: "warmCache",
    name_locked: false,
    description: null,
    description_locked: false,
    type: null,
    type_locked: false,
    isPublic: false,
    actor: null,
    actor_locked: false,
  };
}

function ruleRich(): DesignedRuleNew {
  return {
    name: "priorities-are-unique",
    name_locked: false,
    ruleType: "Structure",
    description: "Two active rules cannot share the same priority value.",
    description_locked: false,
  };
}

/** Covers Rule.{ruleType, description} = null. */
function ruleMinimal(): DesignedRuleNew {
  return {
    name: "tbd-rule",
    name_locked: false,
    ruleType: null,
    description: null,
    description_locked: false,
  };
}

function scenarioRich(): DesignedScenarioNew {
  return {
    name: "applies the highest-priority discount first",
    name_locked: false,
    description:
      "When two discounts apply, the one with the lower priority number wins.",
    description_locked: false,
    given: "a cart with two applicable discounts at priorities 1 and 5",
    given_locked: false,
    when: "calculate is invoked",
    when_locked: false,
    then: "the priority-1 discount is applied first and totals reflect it",
    then_locked: false,
  };
}

function qualityAttributeRich(): DesignedQualityAttributeNew {
  return {
    name: "p99-under-100ms",
    name_locked: false,
    type: "performance",
    description:
      "p99 latency for calculate must stay under 100ms at 200 RPS for a single tenant.",
    description_locked: false,
  };
}

/** Covers QualityAttribute.{type, description} = null. */
function qualityAttributeMinimal(): DesignedQualityAttributeNew {
  return {
    name: "tbd-quality",
    name_locked: false,
    type: null,
    description: null,
    description_locked: false,
  };
}

function changeSet(items: string[]): StringChangeSet {
  return { added: items, modified: [], removed: [] };
}

// ---------- file writes ----------

function writeConversation(projectDir: string, file: Conversation): void {
  const jsonPath = conversationJsonPath(projectDir, file.conversation_id, file.main_topic);
  writeJson(jsonPath, file);
}

function writeDocument(projectDir: string, file: DocumentFileNew): void {
  writeJson(documentJsonPath(projectDir, file.document_id, file.title), file);
}

function writeTopic(projectDir: string, file: TopicFileNew): void {
  writeJson(topicJsonPath(projectDir, file.id, file.title), file);
}

function writeDecision(projectDir: string, file: DecisionFileNew): void {
  writeJson(decisionJsonPath(projectDir, file.id, file.title), file);
}

function writeDesignDoc(projectDir: string, file: DesignDocFileNew): void {
  writeJson(designDocCanonicalPath(projectDir, file.id, file.name), file);
}

function writeJson(path: string, value: unknown): void {
  ensureDir(path);
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`, "utf-8");
}

function ensureDir(path: string): void {
  const dir = path.slice(0, path.lastIndexOf("/"));
  if (dir.length > 0) mkdirSync(dir, { recursive: true });
}
