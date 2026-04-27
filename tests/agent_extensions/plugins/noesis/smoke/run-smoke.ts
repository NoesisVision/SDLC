/**
 * End-to-end smoke test for the noesis plugin.
 *
 * Drives a real `claude -p` session through the full skill chain
 * (analyze-conversation → analyze-design-draft → create-design-doc) against a
 * fresh, empty knowledge graph, then boots the dev backend on the same data
 * directory and asserts the UI view endpoints reflect what the skills wrote.
 *
 * This test consumes LLM tokens. Guard via `NOESIS_SMOKE_CONFIRM=1`.
 *
 * Run from the repo root:
 *   NOESIS_SMOKE_CONFIRM=1 bun run smoke:noesis
 */

import { spawn, type ChildProcess } from "child_process";
import { cpSync, mkdirSync, mkdtempSync, readFileSync } from "fs";
import { tmpdir } from "os";
import { dirname, join, resolve } from "path";
import type { Readable } from "stream";
import { fileURLToPath } from "url";

type ReadablePipedProcess = ChildProcess & {
  stdout: Readable;
  stderr: Readable;
};

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(HERE, "../../../../..");
const PLUGIN_DIR = resolve(
  REPO_ROOT,
  "src/agent_extensions/plugins/noesis",
);
const DEV_SERVER = resolve(
  PLUGIN_DIR,
  "mcp/noesis-graph/dev/dev-server.ts",
);
const FIXTURES_DIR = resolve(HERE, "fixtures");

const SKILL_TIMEOUT_MS = 15 * 60 * 1000;
const BACKEND_BOOT_TIMEOUT_MS = 60 * 1000;

interface SmokeWorkspace {
  baseDataDir: string;
  projectDir: string;
  designDocPath: string;
  transcriptPath: string;
  designDraftPath: string;
  extraContentPath: string;
}

async function main(): Promise<void> {
  requireConfirmation();
  const workspace = setupWorkspace();
  console.log(`[smoke] project_dir = ${workspace.projectDir}`);
  console.log(`[smoke] data_dir    = ${workspace.baseDataDir}`);

  await runAnalyzeConversation(workspace);
  await runAnalyzeDesignDraft(workspace);
  await runCreateDesignDoc(workspace);

  const url = await startVerificationBackend(workspace);
  try {
    await verifyAllViews(url);
    console.log("\n[smoke] ✅ All UI views reflect the produced data.");
    console.log(
      `[smoke] Backend left running at ${url} for visual verification ` +
        "via Playwright MCP. Press Ctrl+C to terminate.",
    );
    await new Promise<void>(() => {
      // hold the process so the backend stays up for manual UI checks
    });
  } catch (err) {
    console.error("[smoke] ❌ verification failed:", err);
    process.exit(1);
  }
}

function requireConfirmation(): void {
  if (process.env["NOESIS_SMOKE_CONFIRM"] !== "1") {
    console.error(
      "[smoke] Refusing to run: this test consumes LLM tokens.\n" +
        "[smoke] Re-run with NOESIS_SMOKE_CONFIRM=1 once the user has approved.",
    );
    process.exit(2);
  }
}

function setupWorkspace(): SmokeWorkspace {
  const root = mkdtempSync(join(tmpdir(), "noesis-smoke-"));
  const baseDataDir = join(root, "data");
  const projectDir = join(root, "project");
  const designDocPath = join(projectDir, "work_items", "sales-design.json");
  mkdirSync(baseDataDir, { recursive: true });
  mkdirSync(dirname(designDocPath), { recursive: true });

  cpSync(FIXTURES_DIR, projectDir, { recursive: true });
  return {
    baseDataDir,
    projectDir,
    designDocPath,
    transcriptPath: join(projectDir, "transcript.md"),
    designDraftPath: join(projectDir, "design-draft.md"),
    extraContentPath: join(projectDir, "extra-requirements.md"),
  };
}

async function runAnalyzeConversation(ws: SmokeWorkspace): Promise<void> {
  const prompt =
    `/noesis:analyze-conversation transcript_path=${ws.transcriptPath} ` +
    `conversation_time="2026-04-15 10:00:00" ` +
    `main_topic="Sales pricing review"`;
  await runClaudeSkill(ws, "analyze-conversation", prompt);
}

async function runAnalyzeDesignDraft(ws: SmokeWorkspace): Promise<void> {
  const prompt =
    `/noesis:analyze-design-draft document_path=${ws.designDraftPath} ` +
    `title="Sales — Order Placement design draft" ` +
    `date="2026-04-20" ` +
    `main_topic="Sales pricing review" ` +
    `design_doc_title="Sales — Order Placement" ` +
    `design_doc_path=${ws.designDocPath}`;
  await runClaudeSkill(ws, "analyze-design-draft", prompt);
}

async function runCreateDesignDoc(ws: SmokeWorkspace): Promise<void> {
  const designDocId = readDesignDocId(ws.designDocPath);
  const prompt =
    `/noesis:create-design-doc design_doc_id=${designDocId} ` +
    `file_paths=${ws.extraContentPath} ` +
    `design_doc_path=${ws.designDocPath}`;
  await runClaudeSkill(ws, "create-design-doc", prompt);
}

function readDesignDocId(path: string): string {
  const raw = readFileSync(path, "utf-8");
  const parsed = JSON.parse(raw) as { id?: unknown };
  if (typeof parsed.id !== "string" || parsed.id.length === 0) {
    throw new Error(
      `Expected design doc id in ${path} after analyze-design-draft, got ${JSON.stringify(parsed.id)}`,
    );
  }
  return parsed.id;
}

async function runClaudeSkill(
  ws: SmokeWorkspace,
  label: string,
  prompt: string,
): Promise<void> {
  console.log(`\n[smoke] === running /noesis:${label} ===`);
  const args = [
    "-p",
    "--plugin-dir",
    PLUGIN_DIR,
    "--add-dir",
    ws.projectDir,
    "--dangerously-skip-permissions",
    "--model",
    "sonnet",
    "--output-format",
    "text",
    prompt,
  ];
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    CLAUDE_PLUGIN_DATA: ws.baseDataDir,
    CLAUDE_PROJECT_DIR: ws.projectDir,
    NOESIS_PROJECT_DIR: ws.projectDir,
  };
  const code = await runCommand(
    "claude",
    args,
    { cwd: ws.projectDir, env },
    SKILL_TIMEOUT_MS,
  );
  if (code !== 0) {
    throw new Error(`/noesis:${label} exited with code ${code}`);
  }
}

async function startVerificationBackend(
  ws: SmokeWorkspace,
): Promise<string> {
  console.log("\n[smoke] === starting verification backend ===");
  const proc = spawn(
    "bun",
    ["run", DEV_SERVER],
    {
      cwd: ws.projectDir,
      env: {
        ...process.env,
        NOESIS_DEV_DATA_DIR: ws.baseDataDir,
        NOESIS_DEV_NO_SEED: "1",
      },
      stdio: ["ignore", "pipe", "pipe"],
    },
  );
  pipeWithPrefix(proc, "[backend]");
  process.on("exit", () => proc.kill("SIGTERM"));

  const url = await waitForBackendUrl(proc);
  return url;
}

async function waitForBackendUrl(
  proc: ReadablePipedProcess,
): Promise<string> {
  return await new Promise<string>((resolveUrl, rejectUrl) => {
    const deadline = Date.now() + BACKEND_BOOT_TIMEOUT_MS;
    const interval = setInterval(() => {
      const url = tryReadDiscoveryUrl();
      if (url !== null) {
        clearInterval(interval);
        resolveUrl(url);
        return;
      }
      if (Date.now() > deadline) {
        clearInterval(interval);
        proc.kill("SIGTERM");
        rejectUrl(new Error("Verification backend did not start in time"));
      }
    }, 500);
    proc.once("exit", (code) => {
      clearInterval(interval);
      rejectUrl(
        new Error(`Verification backend exited prematurely with code ${code}`),
      );
    });
  });
}

function tryReadDiscoveryUrl(): string | null {
  const path = join(tmpdir(), "noesis-graph-dev-server.json");
  try {
    const raw = readFileSync(path, "utf-8");
    const parsed = JSON.parse(raw) as { url?: unknown };
    return typeof parsed.url === "string" ? parsed.url : null;
  } catch {
    return null;
  }
}

async function verifyAllViews(baseUrl: string): Promise<void> {
  const checks: Array<{ name: string; run: () => Promise<void> }> = [
    { name: "topics", run: () => verifyTopics(baseUrl) },
    { name: "decisions", run: () => verifyDecisions(baseUrl) },
    { name: "design-docs", run: () => verifyDesignDocs(baseUrl) },
    { name: "schema-explorer", run: () => verifySchemaExplorer(baseUrl) },
    { name: "model-explorer", run: () => verifyModelExplorer(baseUrl) },
  ];
  for (const check of checks) {
    process.stdout.write(`[smoke] checking ${check.name}... `);
    await check.run();
    process.stdout.write("ok\n");
  }
}

async function verifyTopics(baseUrl: string): Promise<void> {
  const data = await fetchJson<{ topics: { id: string; title: string; conversations: unknown[]; documents: unknown[] }[] }>(
    `${baseUrl}/api/ui/topics`,
  );
  if (!Array.isArray(data.topics) || data.topics.length === 0) {
    throw new Error("topics page is empty");
  }
  const hasConversation = data.topics.some(
    (t) => Array.isArray(t.conversations) && t.conversations.length > 0,
  );
  const hasDocument = data.topics.some(
    (t) => Array.isArray(t.documents) && t.documents.length > 0,
  );
  if (!hasConversation) throw new Error("no topic links to a conversation");
  if (!hasDocument) throw new Error("no topic links to a document");
}

async function verifyDecisions(baseUrl: string): Promise<void> {
  const data = await fetchJson<{ decisions: { id: string; title: string }[] }>(
    `${baseUrl}/api/ui/decisions`,
  );
  if (!Array.isArray(data.decisions) || data.decisions.length === 0) {
    throw new Error("decisions page is empty");
  }
  const detail = await fetchJson<{
    title: string;
    context_text: string;
    decision_text: string;
  }>(`${baseUrl}/api/ui/decisions/${encodeURIComponent(data.decisions[0]!.id)}`);
  if (detail.context_text.length === 0 || detail.decision_text.length === 0) {
    throw new Error("decision detail is missing context/decision text");
  }
}

async function verifyDesignDocs(baseUrl: string): Promise<void> {
  const data = await fetchJson<{ docs: { id: string; title: string }[] }>(
    `${baseUrl}/api/ui/design-docs`,
  );
  if (!Array.isArray(data.docs) || data.docs.length === 0) {
    throw new Error("design docs page is empty");
  }
  const detail = await fetchJson<{
    source: { boundedContexts?: { added: unknown[] } };
  }>(`${baseUrl}/api/ui/design-docs/${encodeURIComponent(data.docs[0]!.id)}`);
  const added = detail.source.boundedContexts?.added ?? [];
  if (added.length === 0) {
    throw new Error("design doc detail has no bounded contexts");
  }
}

async function verifySchemaExplorer(baseUrl: string): Promise<void> {
  await fetchJson(`${baseUrl}/api/ui/schema-explorer`);
}

async function verifyModelExplorer(baseUrl: string): Promise<void> {
  await fetchJson(`${baseUrl}/api/ui/model-explorer`);
}

async function fetchJson<T>(url: string): Promise<T> {
  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`GET ${url} → ${res.status} ${res.statusText}`);
  }
  return (await res.json()) as T;
}

function runCommand(
  cmd: string,
  args: string[],
  opts: { cwd: string; env: NodeJS.ProcessEnv },
  timeoutMs: number,
): Promise<number> {
  return new Promise((resolveCode, rejectCmd) => {
    const proc = spawn(cmd, args, { ...opts, stdio: "inherit" });
    const timer = setTimeout(() => {
      proc.kill("SIGTERM");
      rejectCmd(new Error(`${cmd} timed out after ${timeoutMs}ms`));
    }, timeoutMs);
    proc.once("exit", (code) => {
      clearTimeout(timer);
      resolveCode(code ?? 1);
    });
    proc.once("error", (err) => {
      clearTimeout(timer);
      rejectCmd(err);
    });
  });
}

function pipeWithPrefix(
  proc: ReadablePipedProcess,
  prefix: string,
): void {
  const tag = (chunk: Buffer): string =>
    chunk
      .toString("utf-8")
      .split("\n")
      .filter((line) => line.length > 0)
      .map((line) => `${prefix} ${line}`)
      .join("\n") + "\n";
  proc.stdout.on("data", (chunk: Buffer) => process.stdout.write(tag(chunk)));
  proc.stderr.on("data", (chunk: Buffer) => process.stderr.write(tag(chunk)));
}

void main().catch((err: unknown) => {
  const message = err instanceof Error ? err.message : String(err);
  console.error(`[smoke] fatal: ${message}`);
  process.exit(1);
});
