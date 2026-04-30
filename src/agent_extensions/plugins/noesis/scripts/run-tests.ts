import { Glob } from "bun";
import { relative, resolve } from "path";

const PLUGIN_ROOT = resolve(import.meta.dir, "..");
const PATTERNS = ["**/*.test.ts"];
const IGNORE = ["**/node_modules/**", "mcp/noesis-graph/ui/**"];

interface FileResult {
  file: string;
  status: "pass" | "fail" | "crash";
  exitCode: number | null;
  signal: string | null;
  durationMs: number;
}

async function discoverTestFiles(): Promise<string[]> {
  const found = new Set<string>();
  for (const pattern of PATTERNS) {
    const glob = new Glob(pattern);
    for await (const file of glob.scan({ cwd: PLUGIN_ROOT, dot: false })) {
      if (IGNORE.some((ig) => matchesIgnore(file, ig))) continue;
      found.add(file);
    }
  }
  return [...found].sort();
}

function matchesIgnore(file: string, pattern: string): boolean {
  return new Glob(pattern).match(file);
}

async function runTestFile(file: string): Promise<FileResult> {
  const start = Date.now();
  const proc = Bun.spawn(["bun", "test", file], {
    cwd: PLUGIN_ROOT,
    stdout: "inherit",
    stderr: "inherit",
  });
  const exitCode = await proc.exited;
  const signal = proc.signalCode ?? null;
  const durationMs = Date.now() - start;
  const status: FileResult["status"] =
    signal !== null || (exitCode !== 0 && exitCode !== 1)
      ? "crash"
      : exitCode === 0
        ? "pass"
        : "fail";
  return { file, status, exitCode, signal, durationMs };
}

function printSummary(results: FileResult[]): void {
  const passed = results.filter((r) => r.status === "pass");
  const failed = results.filter((r) => r.status === "fail");
  const crashed = results.filter((r) => r.status === "crash");
  console.log("\n=== Noesis test summary ===");
  console.log(`Total files : ${results.length}`);
  console.log(`Passed      : ${passed.length}`);
  console.log(`Failed      : ${failed.length}`);
  console.log(`Crashed     : ${crashed.length}`);
  if (failed.length > 0) {
    console.log("\nFailed files:");
    for (const r of failed) console.log(`  - ${r.file} (exit=${r.exitCode})`);
  }
  if (crashed.length > 0) {
    console.log("\nCrashed files:");
    for (const r of crashed)
      console.log(
        `  - ${r.file} (exit=${r.exitCode}, signal=${r.signal ?? "-"})`,
      );
  }
}

async function main(): Promise<void> {
  const files = await discoverTestFiles();
  if (files.length === 0) {
    console.log("No test files found.");
    process.exit(0);
  }
  console.log(`Running ${files.length} test files (one Bun process each)…\n`);
  const results: FileResult[] = [];
  for (const file of files) {
    const display = relative(PLUGIN_ROOT, resolve(PLUGIN_ROOT, file));
    console.log(`---\n[run] ${display}`);
    results.push(await runTestFile(file));
  }
  printSummary(results);
  const ok = results.every((r) => r.status === "pass");
  process.exit(ok ? 0 : 1);
}

if (import.meta.main) {
  await main();
}
