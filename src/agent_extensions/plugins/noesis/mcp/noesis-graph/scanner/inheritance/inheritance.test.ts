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
});
