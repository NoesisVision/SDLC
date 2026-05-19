import { describe, test, expect } from "bun:test";
import {
  removeSkippedParts,
  extractNamespace,
  buildModuleHierarchy,
  isExcluded,
  findModuleByPath,
  parseAnnotations,
} from "./scanner.service.js";
import { parentPathOf, type DomainModelTree } from "./domain-model/domain-model.js";

describe("removeSkippedParts", () => {
  test("returns empty string for empty namespace", () => {
    expect(removeSkippedParts("", ["Anything"])).toBe("");
  });

  test("removes a single matching part", () => {
    expect(removeSkippedParts("Foo.Bar.Baz", ["Bar"])).toBe("Foo.Baz");
  });

  test("removes a multi-dot prefix", () => {
    expect(
      removeSkippedParts("MyCompany.ECommerce.Sales.Orders", ["MyCompany.ECommerce"]),
    ).toBe("Sales.Orders");
  });

  test("removes multi-dot pattern occurring in the middle", () => {
    expect(
      removeSkippedParts("A.MyCompany.ECommerce.B", ["MyCompany.ECommerce"]),
    ).toBe("A.B");
  });

  test("applies multiple skip patterns, mixing single and multi-part", () => {
    expect(
      removeSkippedParts("MyCompany.ECommerce.Sales.RestApi.Orders", [
        "MyCompany.ECommerce",
        "RestApi",
      ]),
    ).toBe("Sales.Orders");
  });

  test("leaves namespace untouched when nothing matches", () => {
    expect(removeSkippedParts("Foo.Bar", ["Baz"])).toBe("Foo.Bar");
  });

  test("removes all occurrences of a pattern", () => {
    expect(removeSkippedParts("Foo.EF.Bar.EF.Baz", ["EF"])).toBe("Foo.Bar.Baz");
  });

  test("returns empty string when the whole namespace is skipped", () => {
    expect(removeSkippedParts("MyCompany.ECommerce", ["MyCompany.ECommerce"])).toBe("");
  });

  test("ignores empty skip patterns", () => {
    expect(removeSkippedParts("Foo.Bar", [""])).toBe("Foo.Bar");
  });

  test("does not match a pattern that only partially overlaps a part", () => {
    expect(removeSkippedParts("MyCompany.ECommerceExtra.Foo", ["MyCompany.ECommerce"])).toBe(
      "MyCompany.ECommerceExtra.Foo",
    );
  });
});

describe("extractNamespace", () => {
  test("parses file-scoped namespace", () => {
    const src = `using System;\n\nnamespace MyCompany.ECommerce.Sales.Orders;\n\npublic class Order {}`;
    expect(extractNamespace(src)).toBe("MyCompany.ECommerce.Sales.Orders");
  });

  test("parses braced namespace", () => {
    const src = `using System;\n\nnamespace MyCompany.Foo\n{\n    public class Bar {}\n}`;
    expect(extractNamespace(src)).toBe("MyCompany.Foo");
  });

  test("returns null when no namespace is declared", () => {
    expect(extractNamespace("public class Loose {}")).toBeNull();
  });

  test("returns null for empty content", () => {
    expect(extractNamespace("")).toBeNull();
  });

  test("returns the first namespace when multiple are declared", () => {
    const src = `namespace First.One;\n\nnamespace Second.Two {}`;
    expect(extractNamespace(src)).toBe("First.One");
  });
});

describe("isExcluded", () => {
  test("returns false when no patterns are provided", () => {
    expect(isExcluded("Foo.Bar", [])).toBe(false);
  });

  test("matches exact namespace without wildcards", () => {
    expect(isExcluded("Foo.Bar", ["Foo.Bar"])).toBe(true);
  });

  test("does not match descendants when pattern has no wildcard", () => {
    expect(isExcluded("Foo.Bar.Baz", ["Foo.Bar"])).toBe(false);
  });

  test("does not match partial segment overlap", () => {
    expect(isExcluded("FooBar", ["Foo"])).toBe(false);
  });

  test("trailing star matches self and any descendants", () => {
    expect(isExcluded("Nuke", ["Nuke.*"])).toBe(true);
    expect(isExcluded("Nuke.Foo", ["Nuke.*"])).toBe(true);
    expect(isExcluded("Nuke.Foo.Bar", ["Nuke.*"])).toBe(true);
  });

  test("trailing star does not match unrelated namespaces", () => {
    expect(isExcluded("NukeExtra", ["Nuke.*"])).toBe(false);
    expect(isExcluded("Other.Nuke", ["Nuke.*"])).toBe(false);
  });

  test("middle wildcard matches any namespace containing the literal part", () => {
    expect(
      isExcluded("MyCompany.ECommerce.TechnicalStuff.Crud.Api", ["*.TechnicalStuff.*"]),
    ).toBe(true);
    expect(isExcluded("Foo.TechnicalStuff", ["*.TechnicalStuff.*"])).toBe(true);
    expect(isExcluded("TechnicalStuff.Foo", ["*.TechnicalStuff.*"])).toBe(true);
    expect(isExcluded("TechnicalStuff", ["*.TechnicalStuff.*"])).toBe(true);
  });

  test("middle wildcard requires the literal part to be present", () => {
    expect(isExcluded("MyCompany.ECommerce.Sales", ["*.TechnicalStuff.*"])).toBe(false);
  });

  test("wildcard between literal anchors matches variable-length spans", () => {
    expect(isExcluded("MyCompany.ECommerce.EF", ["MyCompany.ECommerce.*.EF"])).toBe(true);
    expect(
      isExcluded("MyCompany.ECommerce.Sales.Database.Sql.EF", ["MyCompany.ECommerce.*.EF"]),
    ).toBe(true);
    expect(isExcluded("MyCompany.ECommerce.Sales.EF.Migrations", ["MyCompany.ECommerce.*.EF"]))
      .toBe(false);
  });

  test("any of several patterns can exclude", () => {
    const patterns = ["*.TechnicalStuff.*", "Nuke.*"];
    expect(isExcluded("MyCompany.ECommerce.TechnicalStuff", patterns)).toBe(true);
    expect(isExcluded("Nuke.Build", patterns)).toBe(true);
    expect(isExcluded("MyCompany.ECommerce.Sales", patterns)).toBe(false);
  });

  test("ignores empty patterns", () => {
    expect(isExcluded("Foo.Bar", [""])).toBe(false);
  });
});

describe("buildModuleHierarchy", () => {
  test("returns empty lists for no namespaces", () => {
    expect(buildModuleHierarchy([])).toEqual({ boundedContexts: [], modules: [] });
  });

  test("treats a single-part namespace as a bounded context with only a name", () => {
    const { boundedContexts, modules } = buildModuleHierarchy(["Sales"]);
    expect(boundedContexts).toEqual([{ name: "Sales" }]);
    expect(modules).toEqual([]);
  });

  test("builds bounded contexts and modules from nested namespaces", () => {
    const { boundedContexts, modules } = buildModuleHierarchy([
      "Sales.Orders",
      "Sales.Pricing.Discounts",
      "Contacts.Companies",
    ]);

    expect(boundedContexts).toEqual([
      { name: "Contacts" },
      { name: "Sales" },
    ]);

    expect(modules).toEqual([
      { name: "Companies", fullPath: "Contacts.Companies" },
      { name: "Orders", fullPath: "Sales.Orders" },
      { name: "Pricing", fullPath: "Sales.Pricing" },
      { name: "Discounts", fullPath: "Sales.Pricing.Discounts" },
    ]);
  });

  test("deduplicates shared prefixes", () => {
    const { boundedContexts, modules } = buildModuleHierarchy(["Sales.A", "Sales.B"]);
    expect(boundedContexts).toEqual([{ name: "Sales" }]);
    expect(modules.map((m) => m.fullPath).sort()).toEqual(["Sales.A", "Sales.B"]);
  });
});

describe("parentPathOf", () => {
  test("returns empty string for a top-level module (single segment would be a BC, this covers edge)", () => {
    expect(parentPathOf({ name: "Solo", fullPath: "Solo" })).toBe("");
  });

  test("returns the BC name for a top-level module", () => {
    expect(parentPathOf({ name: "Orders", fullPath: "Sales.Orders" })).toBe("Sales");
  });

  test("returns the parent module path for a nested module", () => {
    expect(parentPathOf({ name: "PriceChanges", fullPath: "Sales.Orders.PriceChanges" })).toBe(
      "Sales.Orders",
    );
  });
});

const SAMPLE_TREE: DomainModelTree = {
  boundedContexts: [
    {
      name: "Sales",
      modules: [
        {
          name: "Orders",
          fullPath: "Sales.Orders",
          modules: [
            {
              name: "PriceChanges",
              fullPath: "Sales.Orders.PriceChanges",
              modules: [],
              buildingBlocks: [
                { id: "a.cs:PriceChange", name: "PriceChange", type: "Entity", behaviors: [] },
              ],
            },
          ],
          buildingBlocks: [
            { id: "b.cs:Order", name: "Order", type: "Aggregate", behaviors: [] },
          ],
        },
      ],
      buildingBlocks: [],
    },
    {
      name: "Contacts",
      modules: [],
      buildingBlocks: [
        { id: "c.cs:Company", name: "Company", type: "Entity", behaviors: [] },
      ],
    },
  ],
};

describe("parseAnnotations - behaviors", () => {
  test("extracts public methods as behaviors", () => {
    const src = `
      namespace Sales.Orders;

      [DddAggregate]
      public class Order
      {
        public void Place(ClientId id) { }
        public int Total() => 42;
        public static Item For(ProductAmount p) => new(p);
        private void Internal() { }
      }
    `;
    const matches = parseAnnotations(src);
    expect(matches).toHaveLength(1);
    expect(matches[0].typeName).toBe("Order");
    expect(matches[0].behaviors.map((b) => b.methodName).sort()).toEqual([
      "For",
      "Place",
      "Total",
    ]);
  });

  test("uses DomainBehavior attribute name when present", () => {
    const src = `
      namespace Sales.Orders;

      [DddAggregate]
      public class Order
      {
        [DomainBehavior("Place Order")]
        public void Place() { }

        [DomainBehaviorAttribute("Cancel Order")]
        public void Cancel() { }
      }
    `;
    const matches = parseAnnotations(src);
    const behaviors = matches[0].behaviors;
    const byMethod = new Map(behaviors.map((b) => [b.methodName, b.nameOverride]));
    expect(byMethod.get("Place")).toBe("Place Order");
    expect(byMethod.get("Cancel")).toBe("Cancel Order");
  });

  test("falls back to method name when no override is provided", () => {
    const src = `
      namespace Sales;

      [DddAggregate]
      public class Cart
      {
        [DomainBehavior]
        public void AddItem() { }
      }
    `;
    const matches = parseAnnotations(src);
    expect(matches[0].behaviors).toEqual([
      { methodName: "AddItem", nameOverride: null, actor: null },
    ]);
  });

  test("captures [Actor(\"<name>\")] annotation on a method", () => {
    const src = `
      namespace Sales;

      [DddApplicationService]
      public class OrderApi
      {
        [Actor("Customer")]
        public void Place() { }

        [DomainBehavior("Cancel Order")]
        [ActorAttribute("Approving Manager")]
        public void Cancel() { }

        public void NoActor() { }
      }
    `;
    const matches = parseAnnotations(src);
    const byMethod = new Map(
      matches[0].behaviors.map((b) => [b.methodName, b.actor]),
    );
    expect(byMethod.get("Place")).toBe("Customer");
    expect(byMethod.get("Cancel")).toBe("Approving Manager");
    expect(byMethod.get("NoActor")).toBeNull();
  });

  test("ignores properties, fields, constructors and nested type methods", () => {
    const src = `
      namespace Sales;

      [DddAggregate]
      public class Order
      {
        public int Size { get; set; }
        public int Counter = 0;
        public static readonly Regex Pattern = new Regex("a");
        public Order(int x) { }

        public class Item
        {
          public void InnerOnly() { }
        }

        public void OuterMethod() { }
      }
    `;
    const matches = parseAnnotations(src);
    const outer = matches.find((m) => m.typeName === "Order")!;
    expect(outer.behaviors.map((b) => b.methodName)).toEqual(["OuterMethod"]);
  });

  test("treats interface members without public modifier as behaviors", () => {
    const src = `
      namespace Sales;

      [DddDomainService]
      public interface PriceChangesPolicy
      {
        bool CanChangePrices(int oldQ, int newQ);
        Task<int> GetAsync();
      }
    `;
    const matches = parseAnnotations(src);
    expect(matches[0].behaviors.map((b) => b.methodName).sort()).toEqual([
      "CanChangePrices",
      "GetAsync",
    ]);
  });

  test("returns empty behaviors for delegates and enums", () => {
    const src = `
      namespace Sales;

      [DddDomainEvent]
      public delegate void OrderPlaced(int id);
    `;
    const matches = parseAnnotations(src);
    expect(matches[0].behaviors).toEqual([]);
  });

  test("skips System.Object overrides and record-generated members", () => {
    const src = `
      namespace Sales;

      [DddValueObject]
      public record ClientId(Guid Value)
      {
        public override bool Equals(object? other) => false;
        public bool Equals(ClientId other) => true;
        public override int GetHashCode() => 0;
        public override string ToString() => "x";
        public new Type GetType() => typeof(ClientId);
        public void Deconstruct(out Guid v) { v = Value; }
        public bool PrintMembers(StringBuilder sb) => true;
        protected override void Finalize() { }
        public ClientId MemberwiseClone() => this;
        public static ClientId From(Guid g) => new(g);
      }
    `;
    const matches = parseAnnotations(src);
    expect(matches[0].behaviors.map((b) => b.methodName)).toEqual(["From"]);
  });

  test("handles inheritance and generics in type header", () => {
    const src = `
      namespace Sales;

      [DddAggregate]
      public partial class Order<T> : Aggregate<T>, IEquatable<Order<T>> where T : class
      {
        public void Confirm() { }
      }
    `;
    const matches = parseAnnotations(src);
    expect(matches[0].behaviors.map((b) => b.methodName)).toEqual(["Confirm"]);
  });
});

describe("findModuleByPath", () => {
  test("finds a top-level module", () => {
    expect(findModuleByPath(SAMPLE_TREE, "Sales.Orders")?.name).toBe("Orders");
  });

  test("finds a nested module", () => {
    expect(findModuleByPath(SAMPLE_TREE, "Sales.Orders.PriceChanges")?.name).toBe("PriceChanges");
  });

  test("returns undefined when not found", () => {
    expect(findModuleByPath(SAMPLE_TREE, "Sales.Missing")).toBeUndefined();
  });

  test("does not match bounded contexts", () => {
    expect(findModuleByPath(SAMPLE_TREE, "Sales")).toBeUndefined();
  });
});
