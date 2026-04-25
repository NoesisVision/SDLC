import { mkdirSync } from "fs";
import { basename, dirname, join } from "path";
import { outputResult, parseArgs, requireFile } from "../io.js";

export function getWorkingDir(transcriptPath: string): string {
  const dir = dirname(transcriptPath);
  const stem = basename(transcriptPath).replace(/\.[^.]+$/, "");
  return join(dir, `${stem}_work`);
}

function main(): void {
  const args = parseArgs(["transcript_path"]);
  requireFile(args["transcript_path"]);

  const workingDir = getWorkingDir(args["transcript_path"]);
  mkdirSync(workingDir, { recursive: true });

  outputResult({ status: "Ok", working_dir: workingDir });
}

if (import.meta.main) {
  main();
}
