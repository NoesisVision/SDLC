import { parseArgs, readJson, outputResult, requireFile } from "../io.js";
import { DesignDocSchema } from "./types.js";

async function main(): Promise<void> {
  const args = parseArgs(["input_path", "output_path"]);
  requireFile(args.input_path);

  const designDoc = await readJson(DesignDocSchema, args.input_path);
  await Bun.write(args.output_path, JSON.stringify(designDoc, null, 2));

  outputResult({ status: "Ok", output_path: args.output_path });
}

if (import.meta.main) {
  await main();
}
