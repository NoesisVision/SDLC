import { unlinkSync } from "fs";
import { join } from "path";
import { outputResult, parseArgs, readJson, requireDir, requireFile, writeJson } from "../io.js";
import { PotentialTopicsSchema } from "../../shared-contracts/topics.js";
import { replacePlaceholderIds } from "./topic-helpers.js";

async function main(): Promise<void> {
  const args = parseArgs(["working_dir", "input_file"]);
  requireDir(args["working_dir"]);
  requireFile(args["input_file"]);

  const data = await readJson(PotentialTopicsSchema, args["input_file"]);
  replacePlaceholderIds(data.topics, () => {});

  const outputPath = join(args["working_dir"], "potential_topics.json");
  await writeJson(outputPath, data);

  unlinkSync(args["input_file"]);

  outputResult({ status: "Ok", count: data.topics.length });
}

if (import.meta.main) {
  main();
}
