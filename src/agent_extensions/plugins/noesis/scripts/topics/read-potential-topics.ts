import { existsSync } from "fs";
import { join } from "path";
import { outputResult, parseArgs, readJson, requireDir } from "../io.js";
import { PotentialTopicsSchema } from "./types.js";

async function main(): Promise<void> {
  const args = parseArgs(["working_dir"]);
  requireDir(args["working_dir"]);

  const path = join(args["working_dir"], "potential_topics.json");

  if (!existsSync(path)) {
    outputResult({ status: "Ok", topics: [] });
    return;
  }

  const data = await readJson(PotentialTopicsSchema, path);
  outputResult({ status: "Ok", topics: data.topics });
}

if (import.meta.main) {
  main();
}
