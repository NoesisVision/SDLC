import { exitError, outputResult, parseArgs } from "./io.js";
import { resolveWorkingDir } from "../shared-contracts/plugin-paths.js";

interface ResolveResult {
  status: "Ok";
  working_dir: string;
  skill_name: string;
  execution_id: string;
}

export function resolveSkillWorkingDir(
  skillName: string,
  executionId: string,
  baseTmpDir?: string,
): ResolveResult {
  const workingDir = resolveWorkingDir(skillName, executionId, baseTmpDir);
  return {
    status: "Ok",
    working_dir: workingDir,
    skill_name: skillName,
    execution_id: executionId,
  };
}

function main(): void {
  const args = parseArgs(["skill_name", "execution_id"]);
  try {
    outputResult(
      resolveSkillWorkingDir(args["skill_name"], args["execution_id"]),
    );
  } catch (err) {
    exitError(err instanceof Error ? err.message : String(err));
  }
}

if (import.meta.main) {
  main();
}
