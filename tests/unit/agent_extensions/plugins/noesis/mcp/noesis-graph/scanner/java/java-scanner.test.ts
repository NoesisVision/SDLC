import { describe, expect, test } from "bun:test";
import { relative } from "path";
import { and, given, then, when } from "@tests/bdd.js";
import { fixturePath } from "@tests/helpers/fixtures.js";
import { findJavaFiles, javaScanner } from "@noesis/mcp/noesis-graph/scanner/java/java-scanner.js";
import type { ScannedFile } from "@noesis/mcp/noesis-graph/scanner/language-scanner.js";

const PROJECT = fixturePath("java", "nested-modules");

describe("Java scanner — which files of a project are read", () => {
  test("main sources are read; tests, build output and package declarations are not", async () => {
    let files: string[];

    await given(
      "a Maven project with main sources, a src/test tree, a target/ tree and a package-info.java",
      () => {}
    );
    await when("the project's Java files are listed", async () => {
      files = (await findJavaFiles(PROJECT)).map((f) => relative(PROJECT, f));
    });
    await then("only the main sources are listed, in alphabetical order", () => {
      expect(files).toEqual([
        "src/main/java/com/acme/sales/catalog/Product.java",
        "src/main/java/com/acme/sales/catalog/ProductAdded.java",
        "src/main/java/com/acme/sales/legacy/OldOrder.java",
        "src/main/java/com/acme/sales/orders/Order.java",
        "src/main/java/com/acme/sales/orders/OrderId.java",
        "src/main/java/com/acme/sales/orders/OrderRepository.java",
        "src/main/java/com/acme/sales/orders/pricing/Money.java",
        "src/main/java/com/acme/sales/orders/pricing/PriceCalculator.java",
        "src/main/java/com/acme/sales/SalesPolicy.java",
      ]);
    });
  });

  test("a project is recognised as Java when it has any main Java source", async () => {
    let javaProject: boolean;
    let csharpProject: boolean;

    await given("a Java project and a C#-only project", () => {});
    await when("both are checked for Java", () => {
      return Promise.all([
        javaScanner.detect(PROJECT).then((d) => (javaProject = d)),
        javaScanner.detect(fixturePath("polyglot", "Billing")).then((d) => (csharpProject = d)),
      ]);
    });
    await then("only the Java project is recognised", () => {
      expect(javaProject).toBe(true);
      expect(csharpProject).toBe(false);
    });
  });

  test("each file reports its package and its annotated types", async () => {
    let scanned: ScannedFile[];

    await given("the Maven project", () => {});
    await when("it is scanned", async () => {
      scanned = await javaScanner.scan(PROJECT);
    });
    await then(
      "every file carries the language, its path, its package and the blocks found in it",
      () => {
        const order = scanned.find((f) => f.relativePath.endsWith("orders/Order.java"));
        expect(order).toMatchObject({
          language: "java",
          relativePath: "src/main/java/com/acme/sales/orders/Order.java",
          namespace: "com.acme.sales.orders",
          types: [
            {
              typeName: "Order",
              blockType: "Aggregate",
              nameOverride: null,
              behaviors: [
                { methodName: "place", nameOverride: null, actor: null },
                { methodName: "cancel", nameOverride: null, actor: null },
              ],
            },
          ],
        });
      }
    );
    await and("a file whose types carry no stereotype reports none", () => {
      expect(scanned.map((f) => f.types.length).reduce((a, b) => a + b, 0)).toBe(9);
    });
  });
});
