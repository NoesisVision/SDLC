import { describe, expect, test } from "bun:test";
import { and, given, then, when } from "@tests/bdd.js";
import {
  buildModuleHierarchy,
  findContainer,
  isExcluded,
  removeSkippedParts,
} from "@noesis/mcp/noesis-graph/scanner/namespace-hierarchy.js";

describe("Namespace hierarchy — bounded contexts and nested modules read off dotted namespaces", () => {
  test("the first segment is the bounded context and every deeper segment a nested module", async () => {
    let result: ReturnType<typeof buildModuleHierarchy>;

    await given("namespaces three and four segments deep under one root", () => {});
    await when("the hierarchy is built", () => {
      result = buildModuleHierarchy(["Sales.Orders.Pricing", "Sales.Catalog", "Sales.Orders"]);
    });
    await then("the root is the single bounded context", () => {
      expect(result.boundedContexts).toEqual([{ name: "Sales" }]);
    });
    await and("every intermediate path is a module, nested by its dotted parent path", () => {
      expect(result.modules).toEqual([
        { name: "Catalog", fullPath: "Sales.Catalog" },
        { name: "Orders", fullPath: "Sales.Orders" },
        { name: "Pricing", fullPath: "Sales.Orders.Pricing" },
      ]);
    });
  });

  test("a single-segment namespace is a bounded context with no modules", async () => {
    let result: ReturnType<typeof buildModuleHierarchy>;

    await given("a type declared directly in a one-segment namespace", () => {});
    await when("the hierarchy is built", () => {
      result = buildModuleHierarchy(["Sales"]);
    });
    await then("only the bounded context exists", () => {
      expect(result).toEqual({ boundedContexts: [{ name: "Sales" }], modules: [] });
    });
  });

  test("a type is placed in the deepest container its namespace falls under", async () => {
    let container: string;

    await given(
      "containers for a bounded context and two nested modules, longest path first",
      () => {}
    );
    await when("a namespace below the deepest module is located", () => {
      container = findContainer("Sales.Orders.Pricing", [
        "Sales.Orders.Pricing",
        "Sales.Orders",
        "Sales",
      ]);
    });
    await then("the deepest module owns it", () => {
      expect(container).toBe("Sales.Orders.Pricing");
    });
  });

  test("configured parts are cut out of a namespace wherever they occur, one or many segments long", async () => {
    let stripped: string;

    await given("a namespace carrying a company prefix and a technical layer segment", () => {});
    await when("the multi-segment prefix and the single segment are skipped", () => {
      stripped = removeSkippedParts("MyCompany.ECommerce.Sales.RestApi.Orders", [
        "MyCompany.ECommerce",
        "RestApi",
      ]);
    });
    await then("only the domain segments remain", () => {
      expect(stripped).toBe("Sales.Orders");
    });
  });

  test("a skip that matches only part of a segment leaves the namespace untouched", async () => {
    let result: string;

    await given(
      "a namespace and a skip pattern that shares a substring but not a whole segment",
      () => {}
    );
    await when("the skip is applied", () => {
      result = removeSkippedParts("Foo.Barista", ["Bar"]);
    });
    await then("nothing is removed", () => {
      expect(result).toBe("Foo.Barista");
    });
  });

  test("skipping every segment of a namespace leaves it empty, so it drops out of the model", async () => {
    let result: string;

    await given("a namespace made only of segments the project hides", () => {});
    await when("the skip is applied", () => {
      result = removeSkippedParts("com.acme", ["com.acme"]);
    });
    await then("the namespace is empty", () => {
      expect(result).toBe("");
    });
  });

  test("a skipped part is cut out every time it occurs, not only the first", async () => {
    let result: string;

    await given("a namespace where a technical segment appears twice", () => {});
    await when("that segment is skipped", () => {
      result = removeSkippedParts("Foo.EF.Bar.EF.Baz", ["EF"]);
    });
    await then("both occurrences are gone", () => {
      expect(result).toBe("Foo.Bar.Baz");
    });
  });

  test("an exclude pattern matches whole segments, never part of one", async () => {
    let excluded: boolean;

    await given("a namespace whose only segment starts with the pattern", () => {});
    await when("the namespace is checked", () => {
      excluded = isExcluded("FooBar", ["Foo"]);
    });
    await then("it is not excluded", () => {
      expect(excluded).toBe(false);
    });
  });

  test("a wildcard between two literal anchors spans any number of segments, including none", async () => {
    let adjacent: boolean;
    let deep: boolean;
    let tailBeyondAnchor: boolean;

    await given("a pattern with a literal prefix, a wildcard and a literal last segment", () => {});
    await when(
      "namespaces with nothing, several segments and extra segments after the anchor are checked",
      () => {
        adjacent = isExcluded("MyCompany.ECommerce.EF", ["MyCompany.ECommerce.*.EF"]);
        deep = isExcluded("MyCompany.ECommerce.Sales.Database.Sql.EF", [
          "MyCompany.ECommerce.*.EF",
        ]);
        tailBeyondAnchor = isExcluded("MyCompany.ECommerce.Sales.EF.Migrations", [
          "MyCompany.ECommerce.*.EF",
        ]);
      }
    );
    await then("the namespaces ending on the anchor match", () => {
      expect(adjacent).toBe(true);
      expect(deep).toBe(true);
    });
    await and("a namespace going on past the anchor does not", () => {
      expect(tailBeyondAnchor).toBe(false);
    });
  });

  test("an exclude pattern without a wildcard matches the namespace exactly, not its descendants", async () => {
    let exact: boolean;
    let descendant: boolean;

    await given("an exclude pattern naming one namespace", () => {});
    await when("the namespace and a namespace below it are checked", () => {
      exact = isExcluded("Sales.Legacy", ["Sales.Legacy"]);
      descendant = isExcluded("Sales.Legacy.Orders", ["Sales.Legacy"]);
    });
    await then("only the exact namespace is excluded", () => {
      expect(exact).toBe(true);
      expect(descendant).toBe(false);
    });
  });

  test("a wildcard stands for any run of segments, including none", async () => {
    let trailingSelf: boolean;
    let trailingDeep: boolean;
    let middle: boolean;
    let unrelated: boolean;

    await given("patterns with a trailing and a middle wildcard", () => {});
    await when("namespaces at several depths are checked", () => {
      trailingSelf = isExcluded("Sales.Legacy", ["Sales.Legacy.*"]);
      trailingDeep = isExcluded("Sales.Legacy.Orders.Items", ["Sales.Legacy.*"]);
      middle = isExcluded("com.acme.sales.legacy", ["*.legacy"]);
      unrelated = isExcluded("Sales.Orders", ["Sales.Legacy.*", "*.legacy"]);
    });
    await then("the namespace itself and everything below it match a trailing wildcard", () => {
      expect(trailingSelf).toBe(true);
      expect(trailingDeep).toBe(true);
    });
    await and("a leading wildcard matches the literal tail at any depth", () => {
      expect(middle).toBe(true);
    });
    await and("a namespace outside every pattern stays", () => {
      expect(unrelated).toBe(false);
    });
  });
});
