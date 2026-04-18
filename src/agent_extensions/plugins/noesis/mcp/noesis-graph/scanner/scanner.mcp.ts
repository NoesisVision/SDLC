import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { ScannerService } from "./scanner.service.js";
import { InvocationsService } from "./invocations/invocations.service.js";

export function registerScannerTools(
  mcp: McpServer,
  scanner: ScannerService,
  invocations: InvocationsService,
): void {
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

  mcp.registerTool(
    "get_behavior_invocations",
    {
      description:
        "Returns Invokes relations between domain behaviors. Each edge connects a source behavior to a destination behavior. " +
        "Optionally filter by source or destination behavior id (mutually exclusive).",
      inputSchema: {
        sourceBehaviorId: z
          .string()
          .optional()
          .describe("Return only invocations outgoing from this behavior. Mutually exclusive with destinationBehaviorId."),
        destinationBehaviorId: z
          .string()
          .optional()
          .describe("Return only invocations incoming to this behavior. Mutually exclusive with sourceBehaviorId."),
      },
    },
    async ({ sourceBehaviorId, destinationBehaviorId }) => {
      try {
        const edges = await invocations.getBehaviorInvocations({
          sourceBehaviorId,
          destinationBehaviorId,
        });
        return {
          content: [{ type: "text", text: JSON.stringify({ invocations: edges }, null, 2) }],
        };
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err);
        return { content: [{ type: "text", text: message }], isError: true };
      }
    },
  );
}
