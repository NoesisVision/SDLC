import { describe, test, expect } from "bun:test";
import { and, given, then, when } from "@tests/bdd.js";
import {
  buildModuleHierarchy,
  extractNamespace,
  findModuleByPath,
  isExcluded,
  parseAnnotations,
  removeSkippedParts,
} from "@noesis/mcp/noesis-graph/scanner/scanner.service.js";
import type { DomainModelTree } from "@noesis/mcp/noesis-graph/scanner/domain-model/domain-model.js";

describe("ScannerService — pure helpers that drive the C# domain-model scan", () => {
  test("extractNamespace finds the namespace declaration in a C# file", async () => {
    let ns: string | null = null;

    await given("a C# file source containing a single namespace block", () => {});
    await when("the helper extracts the namespace", () => {
      ns = extractNamespace("namespace MyCompany.Sales {\n  class Foo {}\n}");
    });
    await then("the dotted namespace is returned without surrounding syntax", () => {
      expect(ns).toBe("MyCompany.Sales");
    });
  });

  test("extractNamespace also handles file-scoped namespaces", async () => {
    let ns: string | null = null;

    await given("a C# file using the file-scoped namespace form (semicolon)", () => {});
    await when("the helper extracts the namespace", () => {
      ns = extractNamespace("namespace MyCompany.Sales;\nclass Foo {}");
    });
    await then("the same dotted namespace is recovered", () => {
      expect(ns).toBe("MyCompany.Sales");
    });
  });

  test("removeSkippedParts strips configured single and multi-part prefixes", async () => {
    let stripped: string;

    await given(
      "a deeply nested namespace and a list of parts the project wants to hide",
      () => {},
    );
    await when(
      "the helper removes skipped parts with both a multi-dot and a single token",
      () => {
        stripped = removeSkippedParts(
          "MyCompany.ECommerce.Sales.RestApi.Orders",
          ["MyCompany.ECommerce", "RestApi"],
        );
      },
    );
    await then("the resulting namespace contains only the meaningful segments", () => {
      expect(stripped).toBe("Sales.Orders");
    });
  });

  test("removeSkippedParts leaves a namespace untouched when nothing matches", async () => {
    let result: string;

    await given("a namespace and a skip pattern that does not appear in it", () => {});
    await when("the helper applies the (irrelevant) skip pattern", () => {
      result = removeSkippedParts("Foo.Bar", ["Baz"]);
    });
    await then("the namespace is returned unchanged", () => {
      expect(result).toBe("Foo.Bar");
    });
  });

  test("isExcluded honours wildcard segments in the configured patterns", async () => {
    let salesExcluded: boolean;
    let ordersExcluded: boolean;
    let unrelatedExcluded: boolean;

    await given(
      "a wildcard exclude pattern that matches any third segment under MyCompany.ECommerce",
      () => {},
    );
    await when(
      "two namespaces under that prefix are checked along with one outside it",
      () => {
        salesExcluded = isExcluded("MyCompany.ECommerce.Sales", [
          "MyCompany.ECommerce.*",
        ]);
        ordersExcluded = isExcluded("MyCompany.ECommerce.Orders", [
          "MyCompany.ECommerce.*",
        ]);
        unrelatedExcluded = isExcluded("Other.Sales", ["MyCompany.ECommerce.*"]);
      },
    );
    await then("both matching namespaces are reported excluded", () => {
      expect(salesExcluded).toBe(true);
      expect(ordersExcluded).toBe(true);
    });
    await and("the unrelated namespace is not excluded", () => {
      expect(unrelatedExcluded).toBe(false);
    });
  });

  test("buildModuleHierarchy splits namespaces into bounded contexts and modules", async () => {
    let result: ReturnType<typeof buildModuleHierarchy>;

    await given(
      "two namespaces sharing a top-level token but diverging below it",
      () => {},
    );
    await when("the helper builds a module hierarchy from the namespaces", () => {
      result = buildModuleHierarchy(["Sales.Orders", "Sales.Catalog.Products"]);
    });
    await then("the top-level token becomes the single bounded context", () => {
      expect(result.boundedContexts.map((bc) => bc.name)).toEqual(["Sales"]);
    });
    await and(
      "every intermediate path becomes a module with its full dotted path",
      () => {
        const paths = result.modules.map((m) => m.fullPath).sort();
        expect(paths).toEqual([
          "Sales.Catalog",
          "Sales.Catalog.Products",
          "Sales.Orders",
        ]);
      },
    );
  });

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
                {
                  name: "Items",
                  fullPath: "Sales.Orders.Items",
                  modules: [],
                  buildingBlocks: [],
                },
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

  test("parseAnnotations recognises a DDD annotation and its public methods", async () => {
    let matches: ReturnType<typeof parseAnnotations>;

    const source = `
namespace MyCompany.Sales;

[DddAggregate]
public class Order
{
    public void Confirm() {}

    [DomainBehavior("Cancel order")]
    public void Cancel() {}

    private void Internal() {}
}
`;

    await given("a C# class annotated [DddAggregate] with mixed-visibility methods", () => {});
    await when("the helper parses annotations from the source", () => {
      matches = parseAnnotations(source);
    });
    await then(
      "exactly one annotated type is reported with its annotation and type name",
      () => {
        expect(matches).toHaveLength(1);
        expect(matches[0].annotation).toBe("DddAggregate");
        expect(matches[0].typeName).toBe("Order");
      },
    );
    await and(
      "only the public methods (not the private one) are surfaced as behaviours",
      () => {
        const methodNames = matches[0].behaviors.map((b) => b.methodName).sort();
        expect(methodNames).toEqual(["Cancel", "Confirm"]);
      },
    );
    await and(
      "the [DomainBehavior(\"...\")] override carries the friendly behaviour name",
      () => {
        const cancel = matches[0].behaviors.find((b) => b.methodName === "Cancel");
        expect(cancel?.nameOverride).toBe("Cancel order");
      },
    );
  });

  test("parseAnnotations honours an explicit name override on the type itself", async () => {
    let matches: ReturnType<typeof parseAnnotations>;

    const source = `
namespace MyCompany.Sales;

[DddAggregate("Customer Order")]
public class Order
{
}
`;

    await given(
      "an [Aggregate(\"Customer Order\")] annotation with an explicit display name",
      () => {},
    );
    await when("the source is parsed", () => {
      matches = parseAnnotations(source);
    });
    await then("the type is captured and tagged with the override name", () => {
      expect(matches).toHaveLength(1);
      expect(matches[0].typeName).toBe("Order");
      expect(matches[0].nameOverride).toBe("Customer Order");
    });
  });
});
