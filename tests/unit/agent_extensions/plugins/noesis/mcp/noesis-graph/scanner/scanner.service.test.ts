import { afterAll, describe, expect, test } from "bun:test";
import { Test } from "@nestjs/testing";
import { mkdtempSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { and, given, then, when } from "@tests/bdd.js";
import { fixturePath } from "@tests/helpers/fixtures.js";
import { DATA_DIR, PROJECT_DIR } from "@noesis/mcp/noesis-graph/config/config.module.js";
import { DatabaseService } from "@noesis/mcp/noesis-graph/database/database.service.js";
import { InvocationsService } from "@noesis/mcp/noesis-graph/scanner/invocations/invocations.service.js";
import { ScannerRepository } from "@noesis/mcp/noesis-graph/scanner/scanner.repository.js";
import {
  findModuleByPath,
  ScannerService,
} from "@noesis/mcp/noesis-graph/scanner/scanner.service.js";
import type { DomainModelTree } from "@noesis/mcp/noesis-graph/scanner/domain-model/domain-model.js";

/** The service over a project directory; the in-memory scan never touches the repository. */
function scannerFor(
  projectDir: string,
  repository: Partial<ScannerRepository> = {}
): ScannerService {
  const invocations = {} as unknown as InvocationsService;
  return new ScannerService(repository as ScannerRepository, invocations, projectDir);
}

const blocks = (branch: {
  buildingBlocks: { name: string; type: string; behaviors: { name: string }[] }[];
}) => branch.buildingBlocks.map((b) => [b.name, b.type, b.behaviors.map((x) => x.name)]);

describe("ScannerService — the domain model read off a Java project", () => {
  test("packages nest into bounded context and nested domain modules exactly as the C# scanner nests namespaces", async () => {
    let tree: DomainModelTree;

    await given(
      "a Maven project whose packages go three levels below the company prefix, with `com.acme` configured to skip",
      () => {}
    );
    await when("the project is scanned in memory", async () => {
      tree = await scannerFor(fixturePath("java", "nested-modules")).scanInMemory();
    });
    await then("the first remaining package segment is the single bounded context", () => {
      expect(tree.boundedContexts.map((bc) => bc.name)).toEqual(["sales"]);
    });
    await and("a type declared in the bounded context's own package sits directly under it", () => {
      expect(blocks(tree.boundedContexts[0])).toEqual([
        ["SalesPolicy", "DomainService", ["allows"]],
      ]);
    });
    await and(
      "each deeper package is a module nested in its parent, carrying the types of that package only",
      () => {
        const sales = tree.boundedContexts[0];
        expect(sales.modules.map((m) => [m.name, m.fullPath])).toEqual([
          ["catalog", "sales.catalog"],
          ["orders", "sales.orders"],
        ]);
        const orders = findModuleByPath(tree, "sales.orders");
        expect(orders?.modules.map((m) => [m.name, m.fullPath])).toEqual([
          ["pricing", "sales.orders.pricing"],
        ]);
        expect(blocks(orders!)).toEqual([
          ["Order", "Aggregate", ["cancel", "place"]],
          ["OrderId", "Identifier", []],
          ["OrderRepository", "Port", ["findById", "save"]],
        ]);
        const pricing = findModuleByPath(tree, "sales.orders.pricing");
        expect(pricing?.modules).toEqual([]);
        expect(blocks(pricing!)).toEqual([
          ["Money", "ValueObject", ["add"]],
          ["PriceCalculator", "DomainService", ["priceOf"]],
        ]);
        expect(blocks(findModuleByPath(tree, "sales.catalog")!)).toEqual([
          ["Product", "Entity", ["rename"]],
          ["ProductAdded", "DomainEvent", []],
        ]);
      }
    );
    await and(
      "a package excluded by configuration, test sources and build output contribute nothing",
      () => {
        const allNames = collectBlockNames(tree);
        expect(allNames).not.toContain("OldOrder");
        expect(allNames).not.toContain("OrderInTestNotForScanning");
        expect(allNames).not.toContain("Generated");
        expect(findModuleByPath(tree, "sales.legacy")).toBeUndefined();
      }
    );
  });

  test("block and behavior ids are the source path and the code names, as for C#", async () => {
    let tree: DomainModelTree;

    await given("the same Maven project", () => {});
    await when("it is scanned in memory", async () => {
      tree = await scannerFor(fixturePath("java", "nested-modules")).scanInMemory();
    });
    await then(
      "an aggregate's id is its file path and type name, a behavior's the block id and method name",
      () => {
        const order = findModuleByPath(tree, "sales.orders")?.buildingBlocks.find(
          (b) => b.name === "Order"
        );
        expect(order).toMatchObject({
          id: "src/main/java/com/acme/sales/orders/Order.java:Order",
          behaviors: [
            {
              id: "src/main/java/com/acme/sales/orders/Order.java:Order:cancel",
              name: "cancel",
              actor: null,
            },
            {
              id: "src/main/java/com/acme/sales/orders/Order.java:Order:place",
              name: "place",
              actor: null,
            },
          ],
        });
      }
    );
  });
});

describe("ScannerService — the languages of a project are read off its sources, not configured", () => {
  test("a project holding both C# and Java is scanned in both, into one model", async () => {
    let tree: DomainModelTree;

    await given("a repository with a .NET project and a Maven module side by side", () => {});
    await when("it is scanned in memory", async () => {
      tree = await scannerFor(fixturePath("polyglot")).scanInMemory();
    });
    await then("each language's namespaces form bounded contexts in the same tree", () => {
      // Namespaces are case-sensitive: the C# `Sales` and the Java `sales` are two bounded contexts.
      expect(tree.boundedContexts.map((bc) => bc.name)).toEqual(["sales", "Sales"]);
      expect(blocks(findModuleByPath(tree, "Sales.Billing")!)).toEqual([
        ["Invoice", "Aggregate", ["Issue"]],
      ]);
      expect(blocks(findModuleByPath(tree, "sales.shipping")!)).toEqual([
        ["Shipment", "Aggregate", ["dispatch"]],
      ]);
    });
  });
});

describe("ScannerService — a scan that cannot read the project leaves the previous model alone", () => {
  test("an unreadable noesis-config.json fails the scan before the graph is cleared", async () => {
    let cleared = false;
    let failure: unknown;

    await given("a Java project whose noesis-config.json has a trailing comma", () => {});
    await when("it is scanned into the graph", async () => {
      const repository: Partial<ScannerRepository> = {
        clearModel: async () => {
          cleared = true;
        },
      };
      failure = await scannerFor(fixturePath("java", "broken-config"), repository)
        .scan()
        .catch((error: unknown) => error);
    });
    await then("the scan fails on the config", () => {
      expect(failure).toBeInstanceOf(SyntaxError);
    });
    await and("the model in the graph was never cleared", () => {
      expect(cleared).toBe(false);
    });
  });
});

describe("ScannerService — the scanned model persisted in the graph", () => {
  const dataDir = mkdtempSync(join(tmpdir(), "noesis-scanner-"));
  const modulePromise = Test.createTestingModule({
    providers: [
      DatabaseService,
      ScannerRepository,
      ScannerService,
      { provide: InvocationsService, useValue: {} },
      { provide: DATA_DIR, useValue: dataDir },
      { provide: PROJECT_DIR, useValue: fixturePath("polyglot") },
    ],
  }).compile();

  afterAll(async () => (await modulePromise).close());

  test("the tables of the C#-only graph are dropped when the schema is initialised, as on every start", async () => {
    let tables: string[];

    await given("a graph that still holds the code tables of the C#-only scanner", async () => {
      const module = await modulePromise;
      await module.init();
      const db = module.get(DatabaseService);
      await db.query(
        "CREATE NODE TABLE IF NOT EXISTS CSharpNamespace(name STRING, fullName STRING, PRIMARY KEY(fullName))"
      );
      await db.query(
        "CREATE NODE TABLE IF NOT EXISTS CSharpType(id STRING, name STRING, fullName STRING, filePath STRING, PRIMARY KEY(id))"
      );
      await db.query(
        "CREATE REL TABLE IF NOT EXISTS BC_REPRESENTED_BY_CSHARP_NAMESPACE(FROM BoundedContext TO CSharpNamespace)"
      );
      await db.query(
        "CREATE REL TABLE IF NOT EXISTS MODULE_REPRESENTED_BY_CSHARP_NAMESPACE(FROM Module TO CSharpNamespace)"
      );
      await db.query(
        "CREATE REL TABLE IF NOT EXISTS BB_REPRESENTED_BY_CSHARP_TYPE(FROM BuildingBlock TO CSharpType)"
      );
      await db.query(
        "CREATE REL TABLE IF NOT EXISTS CSHARP_TYPE_IN_CSHARP_NAMESPACE(FROM CSharpType TO CSharpNamespace)"
      );
    });
    await when("the schema is initialised", async () => {
      const module = await modulePromise;
      await module.get(ScannerRepository).initSchema();
      const rows = await module
        .get(DatabaseService)
        .query<{ name: string }>("CALL show_tables() RETURN name");
      tables = rows.map((r) => r.name).sort();
    });
    await then("only the language-neutral code tables remain", () => {
      expect(tables).toEqual([
        "BB_CONTAINS_BEHAVIOR",
        "BB_REPRESENTED_BY_CODE_TYPE",
        "BC_CONTAINS_BB",
        "BC_CONTAINS_MODULE",
        "BC_REPRESENTED_BY_CODE_NAMESPACE",
        "Behavior",
        "BoundedContext",
        "BuildingBlock",
        "CODE_TYPE_IN_CODE_NAMESPACE",
        "CodeNamespace",
        "CodeType",
        "MODULE_CONTAINS_BB",
        "MODULE_CONTAINS_MODULE",
        "MODULE_REPRESENTED_BY_CODE_NAMESPACE",
        "Module",
      ]);
    });
  });

  test("a full scan writes the tree to the graph and reads it back as the in-memory scan produced it, with the code it came from", async () => {
    let scanned: DomainModelTree;
    let read: DomainModelTree;
    let inMemory: DomainModelTree;
    let codeTypes: unknown[];
    let namespaceLinks: unknown[];

    await given("an empty graph and the polyglot repository", async () => {
      const module = await modulePromise;
      await module.init();
      await module.get(ScannerRepository).initSchema();
    });
    await when("the repository is scanned into the graph", async () => {
      const module = await modulePromise;
      const scanner = module.get(ScannerService);
      scanned = await scanner.scan();
      read = await scanner.getDomainModel();
      inMemory = await scanner.scanInMemory();
      const db = module.get(DatabaseService);
      codeTypes = await db.query(
        "MATCH (b:BuildingBlock)-[:BB_REPRESENTED_BY_CODE_TYPE]->(t:CodeType)-[:CODE_TYPE_IN_CODE_NAMESPACE]->(n:CodeNamespace) " +
          "RETURN b.name AS block, t.language AS language, t.fullName AS type, t.filePath AS filePath, n.fullName AS namespace ORDER BY t.fullName"
      );
      namespaceLinks = await db.query(
        "MATCH (m:Module)-[:MODULE_REPRESENTED_BY_CODE_NAMESPACE]->(n:CodeNamespace) RETURN m.fullPath AS module, n.fullName AS namespace, n.language AS language ORDER BY n.fullName"
      );
    });
    await then(
      "the tree returned by the scan, the tree read back and the in-memory tree hold the same model",
      () => {
        // The graph orders siblings by code point and the in-memory tree by locale; the content is what matters.
        expect(sortedByName(scanned)).toEqual(sortedByName(inMemory));
        expect(sortedByName(read)).toEqual(sortedByName(inMemory));
      }
    );
    await and(
      "every block is tied to the code type and namespace it was found in, tagged with its language",
      () => {
        expect(codeTypes).toEqual([
          {
            block: "Invoice",
            language: "csharp",
            type: "Sales.Billing.Invoice",
            filePath: "Billing/Invoice.cs",
            namespace: "Sales.Billing",
          },
          {
            block: "Shipment",
            language: "java",
            type: "sales.shipping.Shipment",
            filePath: "shipping/src/main/java/sales/shipping/Shipment.java",
            namespace: "sales.shipping",
          },
        ]);
        expect(namespaceLinks).toEqual([
          { module: "Sales.Billing", namespace: "Sales.Billing", language: "csharp" },
          { module: "sales.shipping", namespace: "sales.shipping", language: "java" },
        ]);
      }
    );
  });
});

describe("ScannerService — looking a module up in the tree", () => {
  test("findModuleByPath traverses nested bounded contexts to locate a module", async () => {
    let found: ReturnType<typeof findModuleByPath>;
    let missing: ReturnType<typeof findModuleByPath>;

    const tree: DomainModelTree = {
      boundedContexts: [
        {
          name: "Sales",
          modules: [
            {
              name: "Orders",
              fullPath: "Sales.Orders",
              modules: [
                { name: "Items", fullPath: "Sales.Orders.Items", modules: [], buildingBlocks: [] },
              ],
              buildingBlocks: [],
            },
          ],
          buildingBlocks: [],
        },
      ],
    };

    await given("a domain tree with one bounded context and a nested module", () => {});
    await when("the helper looks up the deeply nested module path", () => {
      found = findModuleByPath(tree, "Sales.Orders.Items");
      missing = findModuleByPath(tree, "Sales.Unknown");
    });
    await then("the matching module branch is returned by full path", () => {
      expect(found?.fullPath).toBe("Sales.Orders.Items");
      expect(found?.name).toBe("Items");
    });
    await and("an unknown module path resolves to undefined", () => {
      expect(missing).toBeUndefined();
    });
  });
});

type Branch = { name: string; modules: Branch[]; buildingBlocks: { name: string }[] };

/** The tree with every sibling list in one fixed order, so trees from different sources compare by content. */
function sortedByName(tree: DomainModelTree): DomainModelTree {
  const byName = <T extends { name: string }>(items: T[]) =>
    [...items].sort((a, b) => a.name.localeCompare(b.name));
  const sortBranch = <T extends Branch>(branch: T): T => ({
    ...branch,
    modules: byName(branch.modules).map(sortBranch),
    buildingBlocks: byName(branch.buildingBlocks),
  });
  return { boundedContexts: byName(tree.boundedContexts).map(sortBranch) };
}

function collectBlockNames(tree: DomainModelTree): string[] {
  const names: string[] = [];
  const visit = (branch: { modules: (typeof branch)[]; buildingBlocks: { name: string }[] }) => {
    names.push(...branch.buildingBlocks.map((b) => b.name));
    for (const m of branch.modules) visit(m);
  };
  for (const bc of tree.boundedContexts) visit(bc);
  return names;
}
