import { Glob } from "bun";
import { relative, resolve } from "path";

const REPO_ROOT = resolve(import.meta.dir, "..");
const TESTS_ROOT = resolve(REPO_ROOT, "tests/unit");
const PATTERNS = ["**/*.test.ts"];

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
    for await (const file of glob.scan({ cwd: TESTS_ROOT, dot: false })) {
      found.add(file);
    }
  }
  return [...found].sort();
}

async function runTestFile(absFile: string): Promise<FileResult> {
  const start = Date.now();
  const proc = Bun.spawn(["bun", "test", absFile], {
    cwd: REPO_ROOT,
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
  return { file: absFile, status, exitCode, signal, durationMs };
}

function printSummary(results: FileResult[]): void {
  const passed = results.filter((r) => r.status === "pass");
  const failed = results.filter((r) => r.status === "fail");
  const crashed = results.filter((r) => r.status === "crash");
  console.log("\n=== Unit test summary ===");
  console.log(`Total files : ${results.length}`);
  console.log(`Passed      : ${passed.length}`);
  console.log(`Failed      : ${failed.length}`);
  console.log(`Crashed     : ${crashed.length}`);
  if (failed.length > 0) {
    console.log("\nFailed files:");
    for (const r of failed) {
      console.log(`  - ${relative(REPO_ROOT, r.file)} (exit=${r.exitCode})`);
    }
  }
  if (crashed.length > 0) {
    console.log("\nCrashed files:");
    for (const r of crashed) {
      console.log(
        `  - ${relative(REPO_ROOT, r.file)} (exit=${r.exitCode}, signal=${r.signal ?? "-"})`,
      );
    }
  }
}

async function main(): Promise<void> {
  const files = await discoverTestFiles();
  if (files.length === 0) {
    console.log("No test files found under tests/unit.");
    process.exit(0);
  }
  console.log(`Running ${files.length} test files (one Bun process each)…\n`);
  const results: FileResult[] = [];
  for (const file of files) {
    const absFile = resolve(TESTS_ROOT, file);
    console.log(`---\n[run] ${relative(REPO_ROOT, absFile)}`);
    results.push(await runTestFile(absFile));
  }
  printSummary(results);
  const ok = results.every((r) => r.status === "pass");
  process.exit(ok ? 0 : 1);
}

if (import.meta.main) {
  await main();
}
