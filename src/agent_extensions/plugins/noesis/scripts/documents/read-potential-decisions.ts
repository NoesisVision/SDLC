import { existsSync } from "fs";
import { join } from "path";
import { outputResult, parseArgs, readJson, requireDir } from "../io.js";
import { PotentialDecisionsSchema } from "./save-potential-decisions.js";

async function main(): Promise<void> {
  const args = parseArgs(["working_dir"]);
  requireDir(args["working_dir"]);

  const path = join(args["working_dir"], "potential_decisions.json");
  if (!existsSync(path)) {
    outputResult({ status: "Ok", decisions: [] });
    return;
  }

  const data = await readJson(PotentialDecisionsSchema, path);
  outputResult({ status: "Ok", decisions: data.decisions });
}

if (import.meta.main) {
  main();
}
