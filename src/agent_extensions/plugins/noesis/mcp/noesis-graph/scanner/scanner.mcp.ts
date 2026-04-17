import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { ScannerService } from "./scanner.service.js";

export function registerScannerTools(mcp: McpServer, scanner: ScannerService): void {
  mcp.registerTool(
    "get_domain_model",
    {
      description:
        "Returns the domain model from the knowledge graph (Bounded Contexts, Modules, Building Blocks). " +
        "Optionally filter to a specific Bounded Context (by name) or Module (by full path, e.g. 'Sales.Orders'). " +
        "If no filter is given the full tree is returned.",
      inputSchema: {
        boundedContextName: z
          .string()
          .optional()
          .describe("Name of the Bounded Context to return. Mutually exclusive with modulePath."),
        modulePath: z
          .string()
          .optional()
          .describe("Full dotted path of the Module to return. Mutually exclusive with boundedContextName."),
      },
    },
    async ({ boundedContextName, modulePath }) => {
      try {
        const part = await scanner.getDomainModelPart({ boundedContextName, modulePath });
        return { content: [{ type: "text", text: JSON.stringify(part, null, 2) }] };
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err);
        return { content: [{ type: "text", text: message }], isError: true };
      }
    },
  );
}
