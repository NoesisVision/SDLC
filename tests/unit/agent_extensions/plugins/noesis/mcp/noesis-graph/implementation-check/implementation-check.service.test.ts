import "reflect-metadata";
import {
  describe,
  test,
  beforeEach,
  afterEach,
  expect,
} from "bun:test";
import { mkdtempSync, rmSync } from "fs";
import { writeFile } from "fs/promises";
import { join } from "path";
import { tmpdir } from "os";
import { and, given, then, when } from "@tests/bdd.js";
import { ImplementationCheckService } from "@noesis/mcp/noesis-graph/implementation-check/implementation-check.service.js";
import type { DesignDocsService } from "@noesis/mcp/noesis-graph/knowledge/design-docs/design-docs.service.js";
import type { ScannerService } from "@noesis/mcp/noesis-graph/scanner/scanner.service.js";
import type { DesignDoc } from "@noesis/shared-contracts/design-doc.js";
import type { DomainModelTree } from "@noesis/mcp/noesis-graph/scanner/domain-model/domain-model.js";

interface FakeScanner {
  scanInMemory: () => Promise<DomainModelTree>;
}

interface FakeDesignDocs {
  readDesignDoc: (id: string) => Promise<DesignDoc | null>;
}

function newService(
  scanner: FakeScanner,
  designDocs: FakeDesignDocs,
): ImplementationCheckService {
  return new ImplementationCheckService(
    scanner as unknown as ScannerService,
    designDocs as unknown as DesignDocsService,
  );
}

describe("ImplementationCheckService — comparing live code scans to a design doc", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "noesis-impl-check-"));
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  test("scanToTree delegates to the scanner's in-memory model", async () => {
    let result: DomainModelTree;

    await given(
      "a scanner that exposes a tree containing a single bounded context",
      () => {},
    );
    await when("the service is asked to produce its live scan tree", async () => {
      const scanner: FakeScanner = {
        scanInMemory: async () => ({
          boundedContexts: [
            {
              name: "Sales",
              modules: [],
              buildingBlocks: [],
            },
          ],
        }),
      };
      const designDocs: FakeDesignDocs = { readDesignDoc: async () => null };
      result = await newService(scanner, designDocs).scanToTree();
    });
    await then("the tree returned to the caller is the scanner's tree verbatim", () => {
      expect(result.boundedContexts.map((bc) => bc.name)).toEqual(["Sales"]);
    });
  });

  test("comparing against a non-existent design doc id is rejected with a not-found error", async () => {
    let thrown: Error | null = null;
    let scanPath: string;

    await given(
      "a design-doc store with no entry for the requested id and a scan file on disk",
      async () => {
        scanPath = join(tmpDir, "scan.json");
        await writeFile(
          scanPath,
          JSON.stringify({ boundedContexts: [] }),
          "utf-8",
        );
      },
    );
    await when(
      "the service is asked to compare against the missing design doc id",
      async () => {
        const scanner: FakeScanner = {
          scanInMemory: async () => ({ boundedContexts: [] }),
        };
        const designDocs: FakeDesignDocs = { readDesignDoc: async () => null };
        try {
          await newService(scanner, designDocs).compareImplementationToDesign(
            "ghost",
            scanPath,
            scanPath,
          );
        } catch (e) {
          thrown = e as Error;
        }
      },
    );
    await then("the request fails with a not-found error naming the design doc", () => {
      expect(thrown?.message).toMatch(/DesignDoc not found/);
    });
  });

  test(
    "comparing identical empty before/after scans against an empty design doc reports Ok",
    async () => {
      let result: Awaited<
        ReturnType<ImplementationCheckService["compareImplementationToDesign"]>
      >;

      await given(
        "a stored design doc with no bounded contexts and matching empty scans on disk",
        async () => {
          const path = join(tmpDir, "scan.json");
          await writeFile(
            path,
            JSON.stringify({ boundedContexts: [] }),
            "utf-8",
          );
        },
      );
      await when(
        "the service compares the two scans against the empty design doc",
        async () => {
          const path = join(tmpDir, "scan.json");
          const scanner: FakeScanner = {
            scanInMemory: async () => ({ boundedContexts: [] }),
          };
          const designDocs: FakeDesignDocs = {
            readDesignDoc: async () =>
              ({ id: "dd-empty", name: "Empty", description: "" }) as DesignDoc,
          };
          result = await newService(
            scanner,
            designDocs,
          ).compareImplementationToDesign("dd-empty", path, path);
        },
      );
      await then("the comparison status is Ok", () => {
        expect(result.status).toBe("Ok");
      });
      await and("no problems are reported", () => {
        expect(result.problems).toEqual([]);
      });
    },
  );

  test(
    "comparing scans whose JSON payload does not match the expected shape fails fast",
    async () => {
      let thrown: Error | null = null;

      await given(
        "a stored design doc and a scan file whose contents are not a domain-model tree",
        async () => {
          const path = join(tmpDir, "scan.json");
          await writeFile(path, JSON.stringify({ wrong: "shape" }), "utf-8");
        },
      );
      await when(
        "the service tries to read and compare the malformed scan file",
        async () => {
          const path = join(tmpDir, "scan.json");
          const scanner: FakeScanner = {
            scanInMemory: async () => ({ boundedContexts: [] }),
          };
          const designDocs: FakeDesignDocs = {
            readDesignDoc: async () =>
              ({ id: "dd-shape", name: "Shape", description: "" }) as DesignDoc,
          };
          try {
            await newService(
              scanner,
              designDocs,
            ).compareImplementationToDesign("dd-shape", path, path);
          } catch (e) {
            thrown = e as Error;
          }
        },
      );
      await then("a parse error surfaces so the caller can fix the input", () => {
        expect(thrown).not.toBeNull();
      });
    },
  );
});
