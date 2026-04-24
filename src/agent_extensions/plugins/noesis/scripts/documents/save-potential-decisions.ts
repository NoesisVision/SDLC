import { unlinkSync } from "fs";
import { join } from "path";
import { z } from "zod";
import {
  outputResult,
  parseArgs,
  readJson,
  requireDir,
  requireFile,
  writeJson,
} from "../io.js";

export const PotentialDecisionSchema = z.object({
  id: z.string(),
  topic_id: z.string(),
  title: z.string(),
  status: z.string(),
  short_summary: z.string(),
});
export type PotentialDecision = z.infer<typeof PotentialDecisionSchema>;

export const PotentialDecisionsSchema = z.object({
  decisions: z.array(PotentialDecisionSchema),
});
export type PotentialDecisions = z.infer<typeof PotentialDecisionsSchema>;

async function main(): Promise<void> {
  const args = parseArgs(["working_dir", "input_file"]);
  requireDir(args["working_dir"]);
  requireFile(args["input_file"]);

  const data = await readJson(PotentialDecisionsSchema, args["input_file"]);
  const outputPath = join(args["working_dir"], "potential_decisions.json");
  await writeJson(outputPath, data);

  unlinkSync(args["input_file"]);
  outputResult({ status: "Ok", count: data.decisions.length });
}

if (import.meta.main) {
  main();
}
