import { describe, expect, test } from "bun:test";
import { readFile } from "fs/promises";
import { and, given, then, when } from "@tests/bdd.js";
import { fixturePath } from "@tests/helpers/fixtures.js";
import {
  extractNamespace,
  parseAnnotations,
} from "@noesis/mcp/noesis-graph/scanner/csharp/csharp-scanner.js";

const csharpSource = (name: string) =>
  readFile(fixturePath("csharp", "sources", `${name}.cs`), "utf-8");

describe("C# scanner — namespace and [Ddd*]-annotated types with their public methods", () => {
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

  test("parseAnnotations recognises a DDD annotation and its public methods", async () => {
    let matches: ReturnType<typeof parseAnnotations>;

    const source = await csharpSource("Order");

    await given("a C# class annotated [DddAggregate] with mixed-visibility methods", () => {});
    await when("the helper parses annotations from the source", () => {
      matches = parseAnnotations(source);
    });
    await then("exactly one annotated type is reported with its annotation and type name", () => {
      expect(matches).toHaveLength(1);
      expect(matches[0].annotation).toBe("DddAggregate");
      expect(matches[0].typeName).toBe("Order");
    });
    await and("only the public methods (not the private one) are surfaced as behaviours", () => {
      const methodNames = matches[0].behaviors.map((b) => b.methodName).sort();
      expect(methodNames).toEqual(["Cancel", "Confirm"]);
    });
    await and('the [DomainBehavior("...")] override carries the friendly behaviour name', () => {
      const cancel = matches[0].behaviors.find((b) => b.methodName === "Cancel");
      expect(cancel?.nameOverride).toBe("Cancel order");
    });
  });

  test("parseAnnotations honours an explicit name override on the type itself", async () => {
    let matches: ReturnType<typeof parseAnnotations>;

    const source = await csharpSource("NamedOrder");

    await given(
      'an [Aggregate("Customer Order")] annotation with an explicit display name',
      () => {}
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

  test("parseAnnotations skips inherited object methods (Equals, GetHashCode, …) so they are not surfaced as behaviours", async () => {
    let matches: ReturnType<typeof parseAnnotations>;

    const source = await csharpSource("Money");

    await given(
      "a value-object class whose methods include Equals/GetHashCode/ToString and a domain method",
      () => {}
    );
    await when("the source is parsed", () => {
      matches = parseAnnotations(source);
    });
    await then("only the domain method survives — the inherited object methods are dropped", () => {
      expect(matches).toHaveLength(1);
      const methods = matches[0].behaviors.map((b) => b.methodName).sort();
      expect(methods).toEqual(["IsZero"]);
    });
  });

  test("[Actor] and [ActorAttribute] name who triggers a behaviour", async () => {
    let matches: ReturnType<typeof parseAnnotations>;

    const source = await csharpSource("OrderApi");

    await given(
      "an application service with a method under [Actor], one under [ActorAttribute] after a [DomainBehavior], and one without",
      () => {}
    );
    await when("the source is parsed", () => {
      matches = parseAnnotations(source);
    });
    await then("each behaviour carries its actor, and none where no attribute names one", () => {
      expect(matches[0].behaviors).toEqual([
        { methodName: "Place", nameOverride: null, actor: "Customer" },
        { methodName: "Cancel", nameOverride: "Cancel Order", actor: "Approving Manager" },
        { methodName: "NoActor", nameOverride: null, actor: null },
      ]);
    });
  });

  test("[DomainBehavior] without a name keeps the method name; the Attribute-suffixed form renames like the short one", async () => {
    let matches: ReturnType<typeof parseAnnotations>;

    const source = await csharpSource("Cart");

    await given(
      'an aggregate with a bare [DomainBehavior] and a [DomainBehaviorAttribute("...")]',
      () => {}
    );
    await when("the source is parsed", () => {
      matches = parseAnnotations(source);
    });
    await then("only the named attribute overrides the behaviour name", () => {
      expect(matches[0].behaviors).toEqual([
        { methodName: "AddItem", nameOverride: null, actor: null },
        { methodName: "Clear", nameOverride: "Empty the cart", actor: null },
      ]);
    });
  });

  test("properties, fields, constructors and nested types' methods are not behaviours; expression-bodied and static methods are", async () => {
    let matches: ReturnType<typeof parseAnnotations>;

    const source = await csharpSource("OrderMembers");

    await given(
      "an aggregate with a property, fields with initialisers, a constructor, a nested class with a public method, and three public methods of its own",
      () => {}
    );
    await when("the source is parsed", () => {
      matches = parseAnnotations(source);
    });
    await then("only the aggregate's own methods are behaviours, in declaration order", () => {
      const outer = matches.find((m) => m.typeName === "Order");
      expect(outer?.behaviors.map((b) => b.methodName)).toEqual(["Total", "For", "OuterMethod"]);
    });
  });

  test("interface members are behaviours although they carry no public modifier", async () => {
    let matches: ReturnType<typeof parseAnnotations>;

    const source = await csharpSource("PriceChangesPolicy");

    await given("a [DddDomainService] interface with two members and no modifiers", () => {});
    await when("the source is parsed", () => {
      matches = parseAnnotations(source);
    });
    await then("both members are behaviours", () => {
      expect(matches[0].behaviors.map((b) => b.methodName)).toEqual([
        "CanChangePrices",
        "GetAsync",
      ]);
    });
  });

  test("a delegate and an enum are building blocks without behaviours", async () => {
    let matches: ReturnType<typeof parseAnnotations>;

    const source = await csharpSource("OrderPlaced");

    await given("a [DddDomainEvent] delegate and a [DddValueObject] enum", () => {});
    await when("the source is parsed", () => {
      matches = parseAnnotations(source);
    });
    await then("both are reported with no behaviours", () => {
      expect(matches.map((m) => [m.annotation, m.behaviors])).toEqual([
        ["DddDomainEvent", []],
        ["DddValueObject", []],
      ]);
    });
  });

  test("System.Object overrides and record-generated members are not behaviours", async () => {
    let matches: ReturnType<typeof parseAnnotations>;

    const source = await csharpSource("ClientId");

    await given(
      "a record value object overriding Equals, GetHashCode, ToString, GetType, Finalize, MemberwiseClone and declaring Deconstruct, PrintMembers and a factory method",
      () => {}
    );
    await when("the source is parsed", () => {
      matches = parseAnnotations(source);
    });
    await then("only the factory method is a behaviour", () => {
      expect(matches[0].behaviors.map((b) => b.methodName)).toEqual(["From"]);
    });
  });

  test("generics, base types and constraints in the type header do not hide the body", async () => {
    let matches: ReturnType<typeof parseAnnotations>;

    const source = await csharpSource("GenericOrder");

    await given(
      "a partial generic aggregate inheriting a generic base, implementing an interface and constraining its parameter",
      () => {}
    );
    await when("the source is parsed", () => {
      matches = parseAnnotations(source);
    });
    await then("the type and its one method are found", () => {
      expect(matches.map((m) => [m.typeName, m.behaviors.map((b) => b.methodName)])).toEqual([
        ["Order", ["Confirm"]],
      ]);
    });
  });
});
