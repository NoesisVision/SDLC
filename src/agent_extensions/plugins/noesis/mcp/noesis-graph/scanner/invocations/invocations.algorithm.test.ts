import { describe, test, expect } from "bun:test";
import { sourcesFor } from "./invocations.algorithm.js";
import { extractInheritanceMap } from "../inheritance/inheritance.js";
import type { BehaviorRow } from "./invocations.types.js";

function behaviorsOf(rows: BehaviorRow[]) {
  const byLocation = new Map<string, BehaviorRow>();
  const byTypeMethod = new Map<string, BehaviorRow[]>();
  for (const r of rows) {
    byLocation.set(`${r.filePath}:${r.typeName}:${r.methodName}`, r);
    const key = `${r.typeName}:${r.methodName}`;
    const list = byTypeMethod.get(key) ?? [];
    list.push(r);
    byTypeMethod.set(key, list);
  }
  return { byLocation, byTypeMethod };
}

describe("sourcesFor", () => {
  test("S1: enclosing method is itself a behavior", () => {
    const inv = behaviorsOf([
      { id: "Order.cs:Order:Place", filePath: "Order.cs", typeName: "Order", methodName: "Place" },
    ]);
    const inheritance = extractInheritanceMap([
      { relativePath: "Order.cs", content: `public class Order {}` },
    ]);
    const sources = sourcesFor(
      { filePath: "Order.cs", typeName: "Order", methodName: "Place" },
      inv,
      inheritance,
    );
    expect(sources.map((s) => s.id)).toEqual(["Order.cs:Order:Place"]);
  });

  test("S2: interface member is a source when impl is unannotated", () => {
    const inv = behaviorsOf([
      { id: "IOrder.cs:IOrder:Place", filePath: "IOrder.cs", typeName: "IOrder", methodName: "Place" },
    ]);
    const inheritance = extractInheritanceMap([
      { relativePath: "IOrder.cs", content: `public interface IOrder {}` },
      { relativePath: "Order.cs", content: `public class Order : IOrder {}` },
    ]);
    const sources = sourcesFor(
      { filePath: "Order.cs", typeName: "Order", methodName: "Place" },
      inv,
      inheritance,
    );
    expect(sources.map((s) => s.id)).toEqual(["IOrder.cs:IOrder:Place"]);
  });

  test("S3: base class method is an additional source (E2)", () => {
    const inv = behaviorsOf([
      { id: "Order.cs:Order:Place", filePath: "Order.cs", typeName: "Order", methodName: "Place" },
      { id: "OrderBase.cs:OrderBase:Place", filePath: "OrderBase.cs", typeName: "OrderBase", methodName: "Place" },
    ]);
    const inheritance = extractInheritanceMap([
      { relativePath: "OrderBase.cs", content: `public class OrderBase {}` },
      { relativePath: "Order.cs", content: `public class Order : OrderBase {}` },
    ]);
    const ids = sourcesFor(
      { filePath: "Order.cs", typeName: "Order", methodName: "Place" },
      inv,
      inheritance,
    ).map((s) => s.id).sort();
    expect(ids).toEqual([
      "Order.cs:Order:Place",
      "OrderBase.cs:OrderBase:Place",
    ]);
  });

  test("S5: interface parent NOT followed", () => {
    const inv = behaviorsOf([
      { id: "IBase.cs:IBase:Place", filePath: "IBase.cs", typeName: "IBase", methodName: "Place" },
    ]);
    const inheritance = extractInheritanceMap([
      { relativePath: "IBase.cs", content: `public interface IBase {}` },
      { relativePath: "IChild.cs", content: `public interface IChild : IBase {}` },
      { relativePath: "Order.cs", content: `public class Order : IChild {}` },
    ]);
    const sources = sourcesFor(
      { filePath: "Order.cs", typeName: "Order", methodName: "Place" },
      inv,
      inheritance,
    );
    expect(sources).toEqual([]);
  });

  test("G1: generic base name resolves to generic definition", () => {
    const inv = behaviorsOf([
      {
        id: "IRepository.cs:IRepository:Save",
        filePath: "IRepository.cs",
        typeName: "IRepository",
        methodName: "Save",
      },
    ]);
    const inheritance = extractInheritanceMap([
      { relativePath: "IRepository.cs", content: `public interface IRepository<T> {}` },
      { relativePath: "OrderRepository.cs", content: `public class OrderRepository : IRepository<Order> {}` },
    ]);
    const sources = sourcesFor(
      { filePath: "OrderRepository.cs", typeName: "OrderRepository", methodName: "Save" },
      inv,
      inheritance,
    );
    expect(sources.map((s) => s.id)).toEqual(["IRepository.cs:IRepository:Save"]);
  });
});
