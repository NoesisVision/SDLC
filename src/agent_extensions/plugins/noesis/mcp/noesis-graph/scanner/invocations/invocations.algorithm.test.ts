import { describe, test, expect } from "bun:test";
import { sourcesFor, computeInvocations } from "./invocations.algorithm.js";
import { extractInheritanceMap } from "../inheritance/inheritance.js";
import { makeFakeSerena } from "./fakes.js";
import type { BehaviorRow, SerenaReference } from "./invocations.types.js";

function ref(filePath: string, typeName: string, methodName: string): SerenaReference {
  return { enclosing: { filePath, typeName, methodName } };
}

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

describe("computeInvocations", () => {
  test("D1: direct invocation Place -> Notify", async () => {
    const rows = [
      { id: "Order.cs:Order:Place", filePath: "Order.cs", typeName: "Order", methodName: "Place" },
      { id: "Order.cs:Order:Notify", filePath: "Order.cs", typeName: "Order", methodName: "Notify" },
    ];
    const inv = behaviorsOf(rows);
    const inheritance = extractInheritanceMap([
      { relativePath: "Order.cs", content: `public class Order {}` },
    ]);
    const serena = makeFakeSerena({
      "Order/Notify|Order.cs": [ref("Order.cs", "Order", "Place")],
      "Order/Place|Order.cs": [],
    });

    const edges = await computeInvocations({ behaviors: rows, inv, inheritance, serena });

    expect(edges).toEqual([
      { source: "Order.cs:Order:Place", destination: "Order.cs:Order:Notify" },
    ]);
  });

  test("D2: indirect through non-behavior helper", async () => {
    const rows = [
      { id: "Order.cs:Order:Place", filePath: "Order.cs", typeName: "Order", methodName: "Place" },
      { id: "Order.cs:Order:Notify", filePath: "Order.cs", typeName: "Order", methodName: "Notify" },
    ];
    const inv = behaviorsOf(rows);
    const inheritance = extractInheritanceMap([
      { relativePath: "Order.cs", content: `public class Order {}` },
    ]);
    const serena = makeFakeSerena({
      "Order/Notify|Order.cs": [ref("Order.cs", "Order", "PlaceCore")],
      "Order/PlaceCore|Order.cs": [ref("Order.cs", "Order", "Place")],
      "Order/Place|Order.cs": [],
    });

    const edges = await computeInvocations({ behaviors: rows, inv, inheritance, serena });

    expect(edges).toEqual([
      { source: "Order.cs:Order:Place", destination: "Order.cs:Order:Notify" },
    ]);
  });

  test("D3: barrier — walk stops at the first behavior", async () => {
    const rows = [
      { id: "A.cs:A:a", filePath: "A.cs", typeName: "A", methodName: "a" },
      { id: "A.cs:A:b", filePath: "A.cs", typeName: "A", methodName: "b" },
      { id: "A.cs:A:c", filePath: "A.cs", typeName: "A", methodName: "c" },
    ];
    const inv = behaviorsOf(rows);
    const inheritance = extractInheritanceMap([
      { relativePath: "A.cs", content: `public class A {}` },
    ]);
    const serena = makeFakeSerena({
      "A/c|A.cs": [ref("A.cs", "A", "b")],
      "A/b|A.cs": [ref("A.cs", "A", "a")],
      "A/a|A.cs": [],
    });

    const edges = await computeInvocations({ behaviors: rows, inv, inheritance, serena });

    expect(edges).toContainEqual({ source: "A.cs:A:b", destination: "A.cs:A:c" });
    expect(edges).not.toContainEqual({ source: "A.cs:A:a", destination: "A.cs:A:c" });
  });

  test("D5: cycle safety — mutually recursive helpers terminate", async () => {
    const rows = [
      { id: "X.cs:X:Root", filePath: "X.cs", typeName: "X", methodName: "Root" },
      { id: "X.cs:X:Leaf", filePath: "X.cs", typeName: "X", methodName: "Leaf" },
    ];
    const inv = behaviorsOf(rows);
    const inheritance = extractInheritanceMap([
      { relativePath: "X.cs", content: `public class X {}` },
    ]);
    const serena = makeFakeSerena({
      "X/Leaf|X.cs": [ref("X.cs", "X", "helpA")],
      "X/helpA|X.cs": [ref("X.cs", "X", "helpB")],
      "X/helpB|X.cs": [ref("X.cs", "X", "helpA"), ref("X.cs", "X", "Root")],
      "X/Root|X.cs": [],
    });

    const edges = await computeInvocations({ behaviors: rows, inv, inheritance, serena });

    expect(edges).toEqual([
      { source: "X.cs:X:Root", destination: "X.cs:X:Leaf" },
    ]);
  });

  test("E1 + E2: cartesian product with deduplication", async () => {
    const rows = [
      { id: "Order.cs:Order:Place", filePath: "Order.cs", typeName: "Order", methodName: "Place" },
      { id: "OrderBase.cs:OrderBase:Place", filePath: "OrderBase.cs", typeName: "OrderBase", methodName: "Place" },
      { id: "Order.cs:Order:Notify", filePath: "Order.cs", typeName: "Order", methodName: "Notify" },
    ];
    const inv = behaviorsOf(rows);
    const inheritance = extractInheritanceMap([
      { relativePath: "OrderBase.cs", content: `public class OrderBase {}` },
      { relativePath: "Order.cs", content: `public class Order : OrderBase {}` },
    ]);
    const serena = makeFakeSerena({
      "Order/Notify|Order.cs": [ref("Order.cs", "Order", "Place")],
      "Order/Place|Order.cs": [],
      "OrderBase/Place|OrderBase.cs": [],
    });

    const edges = (await computeInvocations({ behaviors: rows, inv, inheritance, serena })).sort(
      (a, b) => (a.source + a.destination).localeCompare(b.source + b.destination),
    );

    expect(edges).toEqual([
      { source: "Order.cs:Order:Place", destination: "Order.cs:Order:Notify" },
      { source: "OrderBase.cs:OrderBase:Place", destination: "Order.cs:Order:Notify" },
    ]);
  });
});
