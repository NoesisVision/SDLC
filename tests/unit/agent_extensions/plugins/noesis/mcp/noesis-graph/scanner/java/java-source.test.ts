import { describe, expect, test } from "bun:test";
import { readFile } from "fs/promises";
import { and, given, then, when } from "@tests/bdd.js";
import { fixturePath } from "@tests/helpers/fixtures.js";
import {
  extractPackage,
  parseStereotypedTypes,
  stereotypeOf,
} from "@noesis/mcp/noesis-graph/scanner/java/java-source.js";
import type { ScannedType } from "@noesis/mcp/noesis-graph/scanner/language-scanner.js";

const javaSource = (name: string) =>
  readFile(fixturePath("java", "sources", `${name}.java`), "utf-8");

const methodNames = (type: ScannedType | undefined) =>
  type?.behaviors.map((b) => b.methodName) ?? [];

describe("Java source — stereotype-annotated types and their public methods", () => {
  test("the package declaration is the file's namespace", async () => {
    let pkg: string | null;

    await given("a Java file opening with a package declaration", () => {});
    await when("the package is read", async () => {
      pkg = extractPackage(await javaSource("Order"));
    });
    await then("the dotted package name is returned", () => {
      expect(pkg).toBe("com.acme.orders");
    });
  });

  test("a file in the default package has no namespace", async () => {
    let pkg: string | null;

    await given("a Java file without a package declaration", () => {});
    await when("the package is read", () => {
      pkg = extractPackage("public class Loose {}\n");
    });
    await then("no namespace is reported", () => {
      expect(pkg).toBeNull();
    });
  });

  test("an aggregate root's non-private methods are its behaviors; constructors, private methods and the Object trio are not", async () => {
    let types: ScannedType[];

    await given(
      "an @AggregateRoot class with a constructor, public, protected, private and package-private methods, equals/hashCode/toString, and braces inside comments and strings",
      () => {}
    );
    await when("the file is parsed", async () => {
      types = parseStereotypedTypes(await javaSource("Order"));
    });
    await then("the class is one Aggregate building block", () => {
      expect(types.map((t) => [t.typeName, t.blockType])).toEqual([["Order", "Aggregate"]]);
    });
    await and(
      "every method that is not private, a constructor or an Object override is a behavior, in declaration order",
      () => {
        expect(methodNames(types[0])).toEqual([
          "place",
          "apply",
          "draft",
          "audit",
          "packagePrivate",
        ]);
      }
    );
    await and(
      "Java declares no display names, so block and behaviors keep their code names",
      () => {
        expect(types[0].nameOverride).toBeNull();
        expect(types[0].behaviors.every((b) => b.nameOverride === null && b.actor === null)).toBe(
          true
        );
      }
    );
  });

  test("interface members are behaviors unless private, default and static ones included", async () => {
    let types: ScannedType[];

    await given("a @Port interface with abstract, default, static and private methods", () => {});
    await when("the file is parsed", async () => {
      types = parseStereotypedTypes(await javaSource("OrderRepository"));
    });
    await then("the interface is a Port building block", () => {
      expect(types.map((t) => [t.typeName, t.blockType])).toEqual([["OrderRepository", "Port"]]);
    });
    await and("every non-private member is a behavior", () => {
      expect(methodNames(types[0])).toEqual(["save", "findById", "exists", "inMemory"]);
    });
  });

  test("a record's header parameters and compact constructor are not behaviors, its public methods are", async () => {
    let types: ScannedType[];

    await given("a @ValueObject record with a compact constructor and public methods", () => {});
    await when("the file is parsed", async () => {
      types = parseStereotypedTypes(await javaSource("Money"));
    });
    await then("the record is a ValueObject with its public methods as behaviors", () => {
      expect(types.map((t) => [t.typeName, t.blockType])).toEqual([["Money", "ValueObject"]]);
      expect(methodNames(types[0])).toEqual(["add", "zero", "compareTo"]);
    });
  });

  test("an enum is a building block without behaviors", async () => {
    let types: ScannedType[];

    await given("a @ValueObject enum with methods on it and on a constant", () => {});
    await when("the file is parsed", async () => {
      types = parseStereotypedTypes(await javaSource("OrderStatus"));
    });
    await then("the enum is reported with no behaviors", () => {
      expect(types).toEqual([
        { typeName: "OrderStatus", blockType: "ValueObject", nameOverride: null, behaviors: [] },
      ]);
    });
  });

  test("a type without a stereotype annotation is not a building block", async () => {
    let types: ScannedType[];

    await given("a plain public class with public methods", () => {});
    await when("the file is parsed", async () => {
      types = parseStereotypedTypes(await javaSource("Plain"));
    });
    await then("nothing is reported", () => {
      expect(types).toEqual([]);
    });
  });

  test("an annotated nested type is a building block of its own; its unannotated outer type is not", async () => {
    let types: ScannedType[];

    await given(
      "an unannotated class holding an @Event record and a private helper class",
      () => {}
    );
    await when("the file is parsed", async () => {
      types = parseStereotypedTypes(await javaSource("OrderWithNestedTypes"));
    });
    await then("only the nested event is a block, with only its own method", () => {
      expect(types.map((t) => [t.typeName, t.blockType])).toEqual([["Placed", "DomainEvent"]]);
      expect(methodNames(types[0])).toEqual(["isRecent"]);
    });
  });

  test("a fully qualified annotation counts by its simple name, and the declaration's other traps are stepped over", async () => {
    let types: ScannedType[];

    await given(
      "a class annotated with a fully qualified @Adapter, an annotation holding braces and type keywords in strings, a nested annotation, a class literal and an @interface",
      () => {}
    );
    await when("the file is parsed", async () => {
      types = parseStereotypedTypes(await javaSource("JpaOrderRepository"));
    });
    await then("the class is one Adapter with one behavior", () => {
      expect(types.map((t) => [t.typeName, t.blockType])).toEqual([
        ["JpaOrderRepository", "Adapter"],
      ]);
      expect(methodNames(types[0])).toEqual(["save"]);
    });
  });

  test("declarations inside comments, strings and text blocks are not read", async () => {
    let types: ScannedType[];

    await given(
      "a @DomainService whose comments and string literals spell out annotated classes and lone braces",
      () => {}
    );
    await when("the file is parsed", async () => {
      types = parseStereotypedTypes(await javaSource("Templates"));
    });
    await then("only the real class and its real method are reported", () => {
      expect(types.map((t) => [t.typeName, t.blockType])).toEqual([["Templates", "DomainService"]]);
      expect(methodNames(types[0])).toEqual(["render"]);
    });
  });

  test("fields, initialiser blocks and generic-typed fields are not behaviors", async () => {
    let types: ScannedType[];

    await given(
      "an @Entity with public fields, an array initialiser, static and instance initialiser blocks and one method",
      () => {}
    );
    await when("the file is parsed", async () => {
      types = parseStereotypedTypes(await javaSource("Cache"));
    });
    await then("only the method is a behavior", () => {
      expect(methodNames(types[0])).toEqual(["entries"]);
    });
  });

  test("Lombok changes nothing: the hand-written non-private methods are the behaviors, generated accessors never appear", async () => {
    let types: ScannedType[];

    await given(
      "a @Value @Builder value object with fields of every shape Lombok touches, plus package-private, protected and private methods",
      () => {}
    );
    await when("the file is parsed", async () => {
      types = parseStereotypedTypes(await javaSource("LombokValue"));
    });
    await then("only the hand-written methods that are not private are behaviors", () => {
      expect(methodNames(types[0])).toEqual(["pick", "allows", "recompute"]);
    });
  });

  test("annotation arguments nest without limit; the annotated type and methods are still found", async () => {
    let types: ScannedType[];

    await given(
      "an @AggregateRoot whose arguments hold an annotation inside an annotation, a JPA graph annotation between it and the class, and methods under annotations nested three deep",
      () => {}
    );
    await when("the file is parsed", async () => {
      types = parseStereotypedTypes(await javaSource("NestedAnnotations"));
    });
    await then("the class is one Aggregate with every annotated method as a behavior", () => {
      expect(types.map((t) => [t.typeName, t.blockType])).toEqual([["Order", "Aggregate"]]);
      expect(methodNames(types[0])).toEqual(["place", "expire", "retry"]);
    });
  });

  test("a parameter named `record` does not disqualify its method; a nested record declaration is still no behavior", async () => {
    let types: ScannedType[];

    await given(
      "an @ApplicationService with parameters named `record`, a nested record and a plain method",
      () => {}
    );
    await when("the file is parsed", async () => {
      types = parseStereotypedTypes(await javaSource("RecordParameter"));
    });
    await then("the methods taking a `record` are behaviors and the nested record is not", () => {
      expect(methodNames(types[0])).toEqual(["save", "handle", "ok"]);
    });
  });

  test("an annotation of the same name imported from another package is not a stereotype", async () => {
    let types: ScannedType[];

    await given(
      "a file importing JPA's @Entity and Spring's @Repository next to Noesis' @AggregateRoot, with types under each, a fully qualified Noesis @ValueObject and a fully qualified JPA annotation",
      () => {}
    );
    await when("the file is parsed", async () => {
      types = parseStereotypedTypes(await javaSource("ForeignAnnotations"));
    });
    await then("only the types under Noesis annotations are building blocks", () => {
      expect(types.map((t) => [t.typeName, t.blockType])).toEqual([
        ["Order", "Aggregate"],
        ["Money", "ValueObject"],
      ]);
    });
  });

  test("a wildcard import of the Noesis package leaves every stereotype by simple name", async () => {
    let types: ScannedType[];

    await given("a file with `import vision.noesis.annotations.*;` and an @Entity", () => {});
    await when("the file is parsed", async () => {
      types = parseStereotypedTypes(await javaSource("WildcardImport"));
    });
    await then("the type is an Entity block", () => {
      expect(types.map((t) => [t.typeName, t.blockType])).toEqual([["Customer", "Entity"]]);
    });
  });

  test("the first stereotype among a declaration's annotations names the block type", () => {
    expect(stereotypeOf(["Component", "Entity", "Repository"])).toBe("Entity");
    expect(stereotypeOf(["Component", "Override"])).toBeNull();
    expect(stereotypeOf(["AggregateRoot"])).toBe("Aggregate");
    expect(stereotypeOf(["Event"])).toBe("DomainEvent");
    expect(stereotypeOf(["Identifier"])).toBe("Identifier");
  });

  test("a stereotype name bound to another package by an import, or fully qualified with another package, does not count", () => {
    const foreign = new Set(["Entity", "Repository"]);
    expect(stereotypeOf(["Entity", "Repository"], foreign)).toBeNull();
    expect(stereotypeOf(["Entity", "ValueObject"], foreign)).toBe("ValueObject");
    expect(stereotypeOf(["vision.noesis.annotations.Entity"], foreign)).toBe("Entity");
    expect(stereotypeOf(["jakarta.persistence.Entity"])).toBeNull();
  });
});

describe("Java source — formatting does not change what is found", () => {
  const EXPECTED: ScannedType[] = [
    {
      typeName: "Order",
      blockType: "Aggregate",
      nameOverride: null,
      behaviors: [
        { methodName: "place", nameOverride: null, actor: null },
        { methodName: "cancel", nameOverride: null, actor: null },
      ],
    },
  ];

  for (const variant of [
    "FourSpaces",
    "TwoSpaces",
    "Tabs",
    "MixedIndent",
    "Allman",
    "OneLine",
    "Crlf",
  ]) {
    test(`the same aggregate formatted as ${variant} yields the same block and behaviors`, async () => {
      let types: ScannedType[];

      await given(`the aggregate written in the ${variant} style`, () => {});
      await when("the file is parsed", async () => {
        types = parseStereotypedTypes(await javaSource(`format/${variant}`));
      });
      await then("the block, its type and its behaviors are identical to the reference", () => {
        expect(types).toEqual(EXPECTED);
      });
    });
  }
});
