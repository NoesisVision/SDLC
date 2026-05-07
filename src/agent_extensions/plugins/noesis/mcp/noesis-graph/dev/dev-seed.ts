import { Logger } from "@nestjs/common";
import { ScannerRepository } from "../scanner/scanner.repository.js";
import { InvocationsRepository } from "../scanner/invocations/invocations.repository.js";
import { TopicsRepository } from "../knowledge/topics/topics.repository.js";
import { DocumentsRepository } from "../knowledge/documents/documents.repository.js";
import { ConversationsRepository } from "../knowledge/conversations/conversations.repository.js";
import { DecisionsRepository } from "../knowledge/decisions/decisions.repository.js";
import { DesignDocsRepository } from "../knowledge/design-docs/design-docs.repository.js";
import { DatabaseService } from "../database/database.service.js";
import type { Conversation } from "../../../shared-contracts/conversation.js";
import type { DesignDoc } from "../../../shared-contracts/design-doc.js";
import { ideaUnitNodeId } from "../knowledge/conversations/node-ids.js";
import { alternativeOptionNodeId } from "../knowledge/decisions/node-ids.js";
import {
  boundedContextNodeId,
  moduleNodeId,
} from "../knowledge/design-docs/node-ids.js";

interface BuildingBlockFixture {
  id: string;
  name: string;
  type: string;
  containerPath: string;
  csharpTypeId: string;
}

interface BehaviorFixture {
  id: string;
  name: string;
  buildingBlockId: string;
}

interface NamespaceFixture {
  name: string;
  fullName: string;
}

interface CSharpTypeFixture {
  id: string;
  name: string;
  fullName: string;
  filePath: string;
  namespaceFullName: string;
}

interface ModuleFixture {
  name: string;
  fullPath: string;
}

export interface SeedRepositories {
  scanner: ScannerRepository;
  invocations: InvocationsRepository;
  topics: TopicsRepository;
  documents: DocumentsRepository;
  conversations: ConversationsRepository;
  decisions: DecisionsRepository;
  designDocs: DesignDocsRepository;
  db: DatabaseService;
}

const BOUNDED_CONTEXTS: ReadonlyArray<{ name: string; namespaceFullName: string }> = [
  { name: "Sales", namespaceFullName: "Acme.Sales" },
  { name: "Inventory", namespaceFullName: "Acme.Inventory" },
];

const MODULES: ReadonlyArray<ModuleFixture & { namespaceFullName: string }> = [
  { name: "Orders", fullPath: "Sales.Orders", namespaceFullName: "Acme.Sales.Orders" },
  { name: "Customers", fullPath: "Sales.Customers", namespaceFullName: "Acme.Sales.Customers" },
  { name: "Pricing", fullPath: "Sales.Orders.Pricing", namespaceFullName: "Acme.Sales.Orders.Pricing" },
  { name: "Catalog", fullPath: "Inventory.Catalog", namespaceFullName: "Acme.Inventory.Catalog" },
];

const NAMESPACES: ReadonlyArray<NamespaceFixture> = [
  { name: "Sales", fullName: "Acme.Sales" },
  { name: "Inventory", fullName: "Acme.Inventory" },
  { name: "Orders", fullName: "Acme.Sales.Orders" },
  { name: "Customers", fullName: "Acme.Sales.Customers" },
  { name: "Pricing", fullName: "Acme.Sales.Orders.Pricing" },
  { name: "Catalog", fullName: "Acme.Inventory.Catalog" },
];

const CSHARP_TYPES: ReadonlyArray<CSharpTypeFixture> = [
  cs("Order", "Acme.Sales.Orders", "Sales/Orders/Order.cs"),
  cs("OrderLine", "Acme.Sales.Orders", "Sales/Orders/OrderLine.cs"),
  cs("OrderPlaced", "Acme.Sales.Orders", "Sales/Orders/OrderPlaced.cs"),
  cs("OrderRepository", "Acme.Sales.Orders", "Sales/Orders/OrderRepository.cs"),
  cs("PriceCalculator", "Acme.Sales.Orders.Pricing", "Sales/Orders/Pricing/PriceCalculator.cs"),
  cs("Customer", "Acme.Sales.Customers", "Sales/Customers/Customer.cs"),
  cs("CustomerId", "Acme.Sales.Customers", "Sales/Customers/CustomerId.cs"),
  cs("Product", "Acme.Inventory.Catalog", "Inventory/Catalog/Product.cs"),
  cs("Sku", "Acme.Inventory.Catalog", "Inventory/Catalog/Sku.cs"),
  cs("ProductFactory", "Acme.Inventory.Catalog", "Inventory/Catalog/ProductFactory.cs"),
];

const BUILDING_BLOCKS: ReadonlyArray<BuildingBlockFixture> = [
  bb("Order", "Aggregate", "Sales.Orders"),
  bb("OrderLine", "Entity", "Sales.Orders"),
  bb("OrderPlaced", "DomainEvent", "Sales.Orders"),
  bb("OrderRepository", "Repository", "Sales.Orders"),
  bb("PriceCalculator", "DomainService", "Sales.Orders.Pricing"),
  bb("Customer", "Aggregate", "Sales.Customers"),
  bb("CustomerId", "ValueObject", "Sales.Customers"),
  bb("Product", "Aggregate", "Inventory.Catalog"),
  bb("Sku", "ValueObject", "Inventory.Catalog"),
  bb("ProductFactory", "Factory", "Inventory.Catalog"),
];

const BEHAVIORS: ReadonlyArray<BehaviorFixture> = [
  bh("Order", "PlaceOrder"),
  bh("Order", "CancelOrder"),
  bh("OrderLine", "UpdateQuantity"),
  bh("OrderRepository", "Save"),
  bh("OrderRepository", "FindById"),
  bh("PriceCalculator", "Calculate"),
  bh("Customer", "RegisterEmail"),
  bh("Product", "Restock"),
  bh("Product", "MarkUnavailable"),
  bh("ProductFactory", "CreateProduct"),
];

const INVOCATIONS: ReadonlyArray<{ source: string; destination: string }> = [
  invocation("Order", "PlaceOrder", "OrderRepository", "Save"),
  invocation("Order", "PlaceOrder", "PriceCalculator", "Calculate"),
  invocation("Order", "PlaceOrder", "Product", "Restock"),
  invocation("Order", "CancelOrder", "OrderRepository", "Save"),
  invocation("ProductFactory", "CreateProduct", "Product", "Restock"),
];

const DOCUMENT_ID = "doc-handbook";
const DOCUMENT_CONTENT =
  "Repositories should hide persistence details from domain code. " +
  "Aggregates protect their own invariants and emit domain events. " +
  "Domain events let other modules react without coupling.";
const DOCUMENT_FRAGMENTS: ReadonlyArray<{ start: number; end: number }> = [
  { start: 0, end: 62 },
  { start: 63, end: 125 },
  { start: 126, end: DOCUMENT_CONTENT.length },
];

const CONVERSATION: Conversation = {
  conversation_id: "conv-architecture",
  time: "2026-02-10T10:00:00Z",
  main_topic: "Architecture review",
  turns: [
    {
      index: 0,
      speaker: "Alice",
      time: "2026-02-10T10:00:30Z",
      idea_units: [
        {
          index: 0,
          sentences: ["We should encapsulate persistence behind repositories."],
          categories: ["Position"],
        },
        {
          index: 1,
          sentences: ["That keeps aggregates pure and testable."],
          categories: ["Argument"],
        },
      ],
    },
    {
      index: 1,
      speaker: "Bob",
      time: "2026-02-10T10:02:00Z",
      idea_units: [
        {
          index: 0,
          sentences: ["Agreed — let's adopt the repository pattern."],
          categories: ["Decision"],
        },
        {
          index: 1,
          sentences: ["Off-topic chatter."],
          categories: ["Irrelevant"],
        },
      ],
    },
  ],
  topics: [],
};

const ROOT_TOPIC_ID = "topic-architecture";
const SUB_TOPIC_ID = "topic-persistence";
const DECISION_ID = "dec-use-repositories";

const DESIGN_DOC: DesignDoc = {
  id: "dd-sample",
  name: "Sample design",
  description: "Demo design doc covering all design-side node and edge tables.",
  boundedContexts: {
    added: [
      {
        name: "Sales",
        description: "Owns order placement and pricing.",
        modules: {
          added: [
            {
              name: "Orders",
              description: "Order lifecycle.",
              buildingBlocks: {
                added: [
                  {
                    name: "Order",
                    type: "aggregate",
                    description: "Order aggregate root.",
                    properties: {
                      added: [{ name: "id", type: "OrderId" }],
                      removed: [],
                      modified: [],
                    },
                    behaviours: {
                      added: [
                        {
                          name: "PlaceOrder",
                          type: "Command",
                          description: "Place a new order.",
                          isPublic: true,
                          actor: "Customer",
                          input: {
                            added: ["OrderId"],
                            removed: [],
                            modified: [],
                          },
                          output: {
                            added: ["OrderPlaced"],
                            removed: [],
                            modified: [],
                          },
                          usedBuildingBlocks: {
                            added: [],
                            removed: [],
                            modified: [],
                          },
                          rules: {
                            added: [
                              {
                                name: "ValidateTotal",
                                ruleType: "Computation",
                                description: "Order total must be positive.",
                              },
                            ],
                            removed: [],
                            modified: [],
                          },
                          scenarios: {
                            added: [
                              {
                                name: "Happy path",
                                description: "Customer places a valid order.",
                                given: "A customer with a non-empty cart.",
                                when: "PlaceOrder is invoked.",
                                then: "OrderPlaced event is emitted.",
                              },
                            ],
                            removed: [],
                            modified: [],
                          },
                          qualityAttributes: {
                            added: [
                              {
                                name: "Performance:PlaceOrderLatency",
                                type: "performance",
                                description:
                                  "p99 order placement under 200 ms at 100 RPS sustained, measured at the API boundary.",
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
                    rules: { added: [], removed: [], modified: [] },
                    scenarios: { added: [], removed: [], modified: [] },
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
        buildingBlocks: {
          added: [
            {
              name: "PricingPolicy",
              type: "domain_service",
              description: "BC-level pricing rules.",
              properties: { added: [], removed: [], modified: [] },
              behaviours: { added: [], removed: [], modified: [] },
              rules: {
                added: [
                  {
                    name: "MinPrice",
                    ruleType: "Consistency",
                    description: "Prices cannot be negative.",
                  },
                ],
                removed: [],
                modified: [],
              },
              scenarios: {
                added: [
                  {
                    name: "Reject negative",
                    description: "Negative prices are rejected.",
                    given: "A price update with value -1.",
                    when: "PricingPolicy validates the update.",
                    then: "Validation fails.",
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
      },
    ],
    removed: [],
    modified: [],
  },
};

const DESIGN_DOC_V2: DesignDoc = {
  id: "dd-sample-v2",
  name: "Sample design — Pricing iteration",
  description:
    "Pricing iteration: bulk-discount logic plus an updated Order aggregate that applies discounts.",
  boundedContexts: {
    added: [
      {
        name: "Sales",
        description: "Owns order placement, pricing, and bulk discounts.",
        modules: {
          added: [
            {
              name: "Discounts",
              description: "Promotional and bulk pricing.",
              buildingBlocks: {
                added: [
                  {
                    name: "BulkDiscount",
                    type: "value_object",
                    description: "Tiered discount applied to order totals.",
                    properties: {
                      added: [
                        { name: "minQty", type: "Quantity" },
                        { name: "percentage", type: "Percent" },
                      ],
                      removed: [],
                      modified: [],
                    },
                    behaviours: {
                      added: [
                        {
                          name: "Apply",
                          type: "Command",
                          description: "Apply the discount to a subtotal.",
                          isPublic: false,
                          actor: null,
                          input: {
                            added: ["Subtotal"],
                            removed: [],
                            modified: [],
                          },
                          output: {
                            added: ["DiscountedTotal"],
                            removed: [],
                            modified: [],
                          },
                          usedBuildingBlocks: {
                            added: [],
                            removed: [],
                            modified: [],
                          },
                          rules: {
                            added: [
                              {
                                name: "TierMonotonicity",
                                ruleType: "Computation",
                                description:
                                  "Higher quantities never get a smaller discount.",
                              },
                            ],
                            removed: [],
                            modified: [],
                          },
                          scenarios: { added: [], removed: [], modified: [] },
                          qualityAttributes: { added: [], removed: [], modified: [] },
                        },
                      ],
                      removed: [],
                      modified: [],
                    },
                    rules: { added: [], removed: [], modified: [] },
                    scenarios: { added: [], removed: [], modified: [] },
                    qualityAttributes: { added: [], removed: [], modified: [] },
                  },
                ],
                removed: [],
                modified: [],
              },
              qualityAttributes: { added: [], removed: [], modified: [] },
            },
            {
              name: "Orders",
              description: "Order lifecycle, applies bulk discounts.",
              buildingBlocks: {
                added: [
                  {
                    name: "Order",
                    type: "aggregate",
                    description: "Order aggregate root with discounts.",
                    properties: {
                      added: [{ name: "id", type: "OrderId" }],
                      removed: [],
                      modified: [],
                    },
                    behaviours: {
                      added: [
                        {
                          name: "PlaceOrder",
                          type: "Command",
                          description:
                            "Place a new order — applies bulk discounts.",
                          isPublic: true,
                          actor: "Customer",
                          input: { added: ["OrderId"], removed: [], modified: [] },
                          output: {
                            added: ["OrderPlaced"],
                            removed: [],
                            modified: [],
                          },
                          usedBuildingBlocks: {
                            added: ["BulkDiscount"],
                            removed: [],
                            modified: [],
                          },
                          rules: {
                            added: [
                              {
                                name: "MinOrderValue",
                                ruleType: "Consistency",
                                description: "Order total must exceed $5.",
                              },
                            ],
                            removed: [],
                            modified: [],
                          },
                          scenarios: { added: [], removed: [], modified: [] },
                          qualityAttributes: { added: [], removed: [], modified: [] },
                        },
                      ],
                      removed: [],
                      modified: [],
                    },
                    rules: { added: [], removed: [], modified: [] },
                    scenarios: { added: [], removed: [], modified: [] },
                    qualityAttributes: { added: [], removed: [], modified: [] },
                  },
                ],
                removed: [],
                modified: [],
              },
              qualityAttributes: { added: [], removed: [], modified: [] },
            },
          ],
          removed: [],
          modified: [],
        },
        buildingBlocks: { added: [], removed: [], modified: [] },
        qualityAttributes: { added: [], removed: [], modified: [] },
      },
    ],
    removed: [],
    modified: [],
  },
};

export async function seedDevDatabase(repos: SeedRepositories): Promise<void> {
  const logger = new Logger("DevSeed");
  await seedScannerData(repos.scanner, repos.invocations);
  await seedKnowledgeData(
    repos.topics,
    repos.documents,
    repos.conversations,
    repos.decisions,
  );
  await seedDesignDocData(repos.designDocs, repos.db);
  logger.log("Dev database seeded across scanner, knowledge, and design-doc graphs");
}

async function seedScannerData(
  scannerRepo: ScannerRepository,
  invocationsRepo: InvocationsRepository,
): Promise<void> {
  await scannerRepo.clearModel();
  await invocationsRepo.clearInvocations();

  for (const ns of NAMESPACES) {
    await scannerRepo.insertCSharpNamespace(ns);
  }
  for (const t of CSHARP_TYPES) {
    await scannerRepo.insertCSharpType(
      { id: t.id, name: t.name, fullName: t.fullName, filePath: t.filePath },
      t.namespaceFullName,
    );
  }

  for (const bc of BOUNDED_CONTEXTS) {
    await scannerRepo.insertBoundedContext({ name: bc.name });
    await scannerRepo.linkBoundedContextToCSharpNamespace(
      bc.name,
      bc.namespaceFullName,
    );
  }

  const sortedModules = [...MODULES].sort(
    (a, b) => a.fullPath.split(".").length - b.fullPath.split(".").length,
  );
  for (const mod of sortedModules) {
    await scannerRepo.insertModule({ name: mod.name, fullPath: mod.fullPath });
    await scannerRepo.linkModuleToCSharpNamespace(
      mod.fullPath,
      mod.namespaceFullName,
    );
  }

  for (const block of BUILDING_BLOCKS) {
    await scannerRepo.insertBuildingBlock(
      { id: block.id, name: block.name, type: block.type },
      block.containerPath,
      block.csharpTypeId,
    );
  }

  for (const behavior of BEHAVIORS) {
    await scannerRepo.insertBehavior(
      { id: behavior.id, name: behavior.name, actor: null },
      behavior.buildingBlockId,
    );
  }

  for (const inv of INVOCATIONS) {
    await invocationsRepo.insertInvocation(inv);
  }
}

async function seedKnowledgeData(
  topicsRepo: TopicsRepository,
  documentsRepo: DocumentsRepository,
  conversationsRepo: ConversationsRepository,
  decisionsRepo: DecisionsRepository,
): Promise<void> {
  await documentsRepo.insertDocument({
    id: DOCUMENT_ID,
    title: "Engineering Handbook",
    date: "2026-01-15",
    content: DOCUMENT_CONTENT,
  });
  const fragmentIds: string[] = [];
  for (const frag of DOCUMENT_FRAGMENTS) {
    fragmentIds.push(
      await documentsRepo.ensureFragmentNode(DOCUMENT_ID, frag.start, frag.end),
    );
  }

  await conversationsRepo.insertConversation(CONVERSATION);
  const ideaUnitT0I0 = ideaUnitNodeId(CONVERSATION.conversation_id, 0, 0);
  const ideaUnitT0I1 = ideaUnitNodeId(CONVERSATION.conversation_id, 0, 1);
  const ideaUnitT1I0 = ideaUnitNodeId(CONVERSATION.conversation_id, 1, 0);

  await topicsRepo.insertTopicNode({
    id: ROOT_TOPIC_ID,
    title: "Architecture",
    short_summary: "Architecture concerns",
    long_summary: "Top-level container for architecture topics.",
  });
  await topicsRepo.insertTopicNode({
    id: SUB_TOPIC_ID,
    title: "Persistence",
    short_summary: "How aggregates are stored",
    long_summary: "Discussion around repositories vs direct DB access.",
  });
  await topicsRepo.linkSubtopic(ROOT_TOPIC_ID, SUB_TOPIC_ID);
  await topicsRepo.linkToIdeaUnit(SUB_TOPIC_ID, ideaUnitT0I0);
  await topicsRepo.linkToIdeaUnit(SUB_TOPIC_ID, ideaUnitT0I1);
  await topicsRepo.linkToDocumentFragment(SUB_TOPIC_ID, fragmentIds[0]);
  await topicsRepo.linkToDocumentFragment(SUB_TOPIC_ID, fragmentIds[1]);

  await decisionsRepo.insertDecisionNode({
    id: DECISION_ID,
    title: "Adopt repository pattern",
    status: "accepted",
    referenced_items: [],
    context: {
      text: "Aggregates currently leak persistence concerns into the domain layer.",
      supporting_item_indices: [],
    },
    decision: {
      text: "Introduce a repository per aggregate.",
      rationale: "Keeps aggregates pure and easier to test.",
      supporting_item_indices: [],
    },
    alternative_options: [],
  });
  await decisionsRepo.linkTopicToDecision(SUB_TOPIC_ID, DECISION_ID);

  const altId = alternativeOptionNodeId(DECISION_ID, 0);
  await decisionsRepo.insertAlternativeOption(altId, 0, {
    text: "Inline ORM calls inside aggregates.",
    rationale: "Less indirection but couples domain to persistence.",
    supporting_item_indices: [],
  });
  await decisionsRepo.linkDecisionToAlternative(DECISION_ID, altId);

  await decisionsRepo.linkDecisionSlotToIdeaUnit(
    DECISION_ID,
    { slot: "context" },
    ideaUnitT0I0,
  );
  await decisionsRepo.linkDecisionSlotToFragment(
    DECISION_ID,
    { slot: "context" },
    fragmentIds[0],
  );
  await decisionsRepo.linkDecisionSlotToIdeaUnit(
    DECISION_ID,
    { slot: "decision" },
    ideaUnitT1I0,
  );
  await decisionsRepo.linkDecisionSlotToFragment(
    DECISION_ID,
    { slot: "decision" },
    fragmentIds[1],
  );
  await decisionsRepo.linkAlternativeToIdeaUnit(altId, ideaUnitT0I1);
  await decisionsRepo.linkAlternativeToFragment(altId, fragmentIds[2]);
}

async function seedDesignDocData(
  designDocsRepo: DesignDocsRepository,
  db: DatabaseService,
): Promise<void> {
  await designDocsRepo.upsertActor(
    { name: "Customer", description: "End user placing orders." },
    false,
  );
  await designDocsRepo.upsertActor(
    {
      name: "Warehouse Operator",
      description: "Fulfils orders from the warehouse floor.",
    },
    false,
  );
  await designDocsRepo.replaceDesignDoc(DESIGN_DOC, "2026-04-20");
  await designDocsRepo.replaceDesignDoc(DESIGN_DOC_V2, "2026-04-26");
  await seedNestedDesignedModule(db);
}

async function seedNestedDesignedModule(db: DatabaseService): Promise<void> {
  // applyDesignDoc never creates DM_HAS_MODULE because DesignedDomainModule
  // has no nested-module field. Insert one synthetic child module + edge so
  // the rel table is non-empty and visible in the schema explorer.
  const bcId = boundedContextNodeId(DESIGN_DOC.id, "Sales");
  const parentModuleId = moduleNodeId(bcId, "Sales.Orders");
  const childModuleId = `${parentModuleId}|M:Sales.Orders.Fulfillment`;
  await db.query(
    "CREATE (m:DesignedDomainModule {id: $id, name: $name, full_path: $full_path, description: $description})",
    {
      id: childModuleId,
      name: "Fulfillment",
      full_path: "Sales.Orders.Fulfillment",
      description: "Nested module under Orders for shipment handling.",
    },
  );
  await db.query(
    "MATCH (parent:DesignedDomainModule), (child:DesignedDomainModule) " +
      "WHERE parent.id = $parentId AND child.id = $childId " +
      "CREATE (parent)-[:DM_HAS_MODULE]->(child)",
    { parentId: parentModuleId, childId: childModuleId },
  );
}

function cs(name: string, namespaceFullName: string, filePath: string): CSharpTypeFixture {
  return {
    id: `${namespaceFullName}.${name}`,
    name,
    fullName: `${namespaceFullName}.${name}`,
    filePath,
    namespaceFullName,
  };
}

function bb(name: string, type: string, containerPath: string): BuildingBlockFixture {
  const namespaceFullName = `Acme.${containerPath}`;
  return {
    id: name,
    name,
    type,
    containerPath,
    csharpTypeId: `${namespaceFullName}.${name}`,
  };
}

function bh(buildingBlockId: string, methodName: string): BehaviorFixture {
  return {
    id: `${buildingBlockId}:${methodName}`,
    name: methodName,
    buildingBlockId,
  };
}

function invocation(
  sourceBb: string,
  sourceMethod: string,
  destBb: string,
  destMethod: string,
): { source: string; destination: string } {
  return {
    source: `${sourceBb}:${sourceMethod}`,
    destination: `${destBb}:${destMethod}`,
  };
}
