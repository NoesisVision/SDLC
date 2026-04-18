import { describe, test, expect } from "bun:test";
import { extractInheritanceMap } from "./inheritance.js";

describe("extractInheritanceMap", () => {
  test("extracts a class with one base and two interfaces", () => {
    const files = [
      {
        relativePath: "src/Order.cs",
        content: `namespace Sales;\npublic class Order : OrderBase, IOrder, IAggregate {}`,
      },
    ];

    const map = extractInheritanceMap(files);

    const header = map.byTypeName.get("Order");
    expect(header).toBeDefined();
    expect(header!.length).toBe(1);
    expect(header![0].typeName).toBe("Order");
    expect(header![0].filePath).toBe("src/Order.cs");
    expect(header![0].baseTypeNames).toEqual(["OrderBase"]);
    expect(header![0].interfaceTypeNames).toEqual(["IOrder", "IAggregate"]);
  });

  test("class with no inheritance clause has empty ancestor lists", () => {
    const files = [{ relativePath: "src/Foo.cs", content: `public class Foo {}` }];
    const header = extractInheritanceMap(files).byTypeName.get("Foo")![0];
    expect(header.baseTypeNames).toEqual([]);
    expect(header.interfaceTypeNames).toEqual([]);
  });

  test("byTypeId is keyed by `${filePath}:${typeName}`", () => {
    const files = [
      { relativePath: "src/Order.cs", content: `public class Order {}` },
    ];
    const map = extractInheritanceMap(files);
    expect(map.byTypeId.get("src/Order.cs:Order")).toBeDefined();
  });

  test("strips generic args from ancestor names (G1)", () => {
    const files = [
      {
        relativePath: "src/OrderRepository.cs",
        content: `public class OrderRepository : IRepository<Order>, IDisposable {}`,
      },
    ];
    const h = extractInheritanceMap(files).byTypeName.get("OrderRepository")![0];
    expect(h.baseTypeNames).toEqual(["IRepository"]);
    expect(h.interfaceTypeNames).toEqual(["IDisposable"]);
  });

  test("records and structs are parsed", () => {
    const files = [
      { relativePath: "src/Money.cs", content: `public record Money : IEquatable<Money> {}` },
      { relativePath: "src/Point.cs", content: `public struct Point : IComparable {}` },
    ];
    const map = extractInheritanceMap(files);
    expect(map.byTypeName.get("Money")![0].baseTypeNames).toEqual(["IEquatable"]);
    expect(map.byTypeName.get("Point")![0].baseTypeNames).toEqual(["IComparable"]);
  });

  test("multiple top-level types in one file", () => {
    const files = [
      {
        relativePath: "src/Mix.cs",
        content:
          `public class A : IA {}\n\npublic interface IA {}\n\npublic class B : A {}`,
      },
    ];
    const map = extractInheritanceMap(files);
    expect(map.byTypeName.get("A")![0].interfaceTypeNames).toEqual(["IA"]);
    expect(map.byTypeName.get("IA")![0].baseTypeNames).toEqual([]);
    expect(map.byTypeName.get("B")![0].baseTypeNames).toEqual(["A"]);
  });

  test("interface inheriting interfaces", () => {
    const files = [
      { relativePath: "src/IChild.cs", content: `public interface IChild : IBase, IMarker {}` },
    ];
    const h = extractInheritanceMap(files).byTypeName.get("IChild")![0];
    expect(h.baseTypeNames).toEqual(["IBase"]);
    expect(h.interfaceTypeNames).toEqual(["IMarker"]);
  });

  test("same type name from different files produces two entries in byTypeName", () => {
    const files = [
      { relativePath: "src/A/Order.cs", content: `public class Order {}` },
      { relativePath: "src/B/Order.cs", content: `public class Order {}` },
    ];
    const list = extractInheritanceMap(files).byTypeName.get("Order")!;
    expect(list.length).toBe(2);
    expect(list[0].filePath).not.toBe(list[1].filePath);
  });

  test("malformed declaration is skipped without throwing", () => {
    const files = [
      { relativePath: "src/Broken.cs", content: `public class Broken : // unterminated` },
      { relativePath: "src/Ok.cs", content: `public class Ok {}` },
    ];
    const map = extractInheritanceMap(files);
    expect(map.byTypeName.get("Ok")).toBeDefined();
  });
});

import { ancestorsOf } from "./inheritance.js";

describe("ancestorsOf", () => {
  const files = [
    { relativePath: "IEntity.cs", content: `public interface IEntity {}` },
    { relativePath: "IOrder.cs", content: `public interface IOrder : IEntity {}` },
    { relativePath: "OrderBase.cs", content: `public class OrderBase : IOrder {}` },
    { relativePath: "Order.cs", content: `public class Order : OrderBase, IMarker {}` },
    { relativePath: "IMarker.cs", content: `public interface IMarker {}` },
  ];
  const map = extractInheritanceMap(files);

  test("returns directly-declared interfaces on the class", () => {
    const ancestors = ancestorsOf(map, "Order");
    expect(ancestors).toContain("IMarker");
  });

  test("walks the class base chain transitively (S3)", () => {
    const ancestors = ancestorsOf(map, "Order");
    expect(ancestors).toContain("OrderBase");
  });

  test("includes interfaces declared on base classes (S2 + S3)", () => {
    const ancestors = ancestorsOf(map, "Order");
    expect(ancestors).toContain("IOrder");
  });

  test("does NOT traverse interface parents (S5)", () => {
    const ancestors = ancestorsOf(map, "Order");
    expect(ancestors).not.toContain("IEntity");
  });

  test("returns empty list for unknown type", () => {
    expect(ancestorsOf(map, "Unknown")).toEqual([]);
  });
});
