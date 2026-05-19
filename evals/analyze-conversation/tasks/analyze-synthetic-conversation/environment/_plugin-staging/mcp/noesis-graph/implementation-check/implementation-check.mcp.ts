import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { runFileOutputTool, runInlineJsonTool } from "../mcp-tool-output.js";
import { ImplementationCheckService } from "./implementation-check.service.js";

export function registerImplementationCheckTools(
  mcp: McpServer,
  service: ImplementationCheckService,
): void {
  mcp.registerTool(
    "scan_to_tmp",
    {
      description:
        "Scan the current project source for the domain model (Bounded Contexts, Modules, Building Blocks, Behaviors) " +
        "and write the resulting tree to a tmp JSON file. Does NOT touch the knowledge graph DB or any source file. " +
        "Returns the tmp file path — read it with the Read tool, or pass it to compare_implementation_to_design.",
      inputSchema: {},
    },
    async () =>
      runFileOutputTool(
        "scan_to_tmp",
        () => service.scanToTree(),
        (tree) => JSON.stringify(tree, null, 2),
        "json",
      ),
  );

  mcp.registerTool(
    "compare_implementation_to_design",
    {
      description:
        "Compare the diff between two scan tmp files (before / after implementation) against the diff declared by a Design Doc. " +
        "Comparison is restricted to Bounded Contexts, Modules, Building Blocks and Behaviors — Rules, Scenarios and Properties are ignored. " +
        "Returns { status: \"Ok\", problems: [] } when the implemented diff matches the design doc exactly, " +
        "or { status: \"Mismatch\", problems: string[] } listing every missing or unexpected change so the agent can fix them.",
      inputSchema: {
        design_doc_id: z.string().describe("Id of the Design Doc that drove the implementation."),
        before_scan_path: z
          .string()
          .describe("Tmp file written by scan_to_tmp before implementation started."),
        after_scan_path: z
          .string()
          .describe("Tmp file written by scan_to_tmp after implementation finished."),
      },
    },
    async ({ design_doc_id, before_scan_path, after_scan_path }) =>
      runInlineJsonTool(() =>
        service.compareImplementationToDesign(
          design_doc_id,
          before_scan_path,
          after_scan_path,
        ),
      ),
  );
}
