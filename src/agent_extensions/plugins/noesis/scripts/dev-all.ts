import { platform } from "os";
import { resolve } from "path";

const PLUGIN_ROOT = resolve(import.meta.dir, "..");
const UI_DIR = resolve(PLUGIN_ROOT, "mcp/noesis-graph/ui");
const BACKEND_ENTRY = resolve(
  PLUGIN_ROOT,
  "mcp/noesis-graph/dev/dev-server.ts",
);

const BACKEND_READY = /Nest application successfully started/;
const VITE_URL = /Local:\s+(https?:\/\/\S+)/;

type Label = "backend" | "ui";

interface ChildSpec {
  label: Label;
  cmd: string[];
  cwd: string;
  color: string;
  onLine?: (line: string) => void;
}

const RESET = "\x1b[0m";
const COLORS: Record<Label, string> = {
  backend: "\x1b[36m",
  ui: "\x1b[35m",
};

async function main(): Promise<void> {
  const browser = createBrowserOpener();

  const children: ChildSpec[] = [
    {
      label: "backend",
      cmd: ["bun", "run", BACKEND_ENTRY],
      cwd: PLUGIN_ROOT,
      color: COLORS.backend,
      onLine: (line) => {
        if (BACKEND_READY.test(line)) browser.markBackendReady();
      },
    },
    {
      label: "ui",
      cmd: ["bun", "run", "dev"],
      cwd: UI_DIR,
      color: COLORS.ui,
      onLine: (line) => {
        const match = line.match(VITE_URL);
        if (match !== null) browser.setUiUrl(match[1].replace(/\/$/, ""));
      },
    },
  ];

  const procs = children.map((c) => spawnTagged(c));
  installShutdown(procs);
  const exits = await Promise.all(procs.map((p) => p.exited));
  const failed = exits.find((code) => code !== 0);
  process.exit(failed ?? 0);
}

function createBrowserOpener(): {
  markBackendReady: () => void;
  setUiUrl: (url: string) => void;
} {
  let backendReady = false;
  let uiUrl: string | null = null;
  let opened = false;
  const tryOpen = (): void => {
    if (opened) return;
    if (!backendReady || uiUrl === null) return;
    opened = true;
    openBrowser(uiUrl);
  };
  return {
    markBackendReady: () => {
      backendReady = true;
      tryOpen();
    },
    setUiUrl: (url) => {
      uiUrl = url;
      tryOpen();
    },
  };
}

function openBrowser(url: string): void {
  const cmd = browserCommand(url);
  if (cmd === null) return;
  Bun.spawn(cmd, { stdout: "ignore", stderr: "ignore" });
}

function browserCommand(url: string): string[] | null {
  switch (platform()) {
    case "darwin":
      return ["open", url];
    case "win32":
      return ["cmd", "/c", "start", "", url];
    case "linux":
      return ["xdg-open", url];
    default:
      return null;
  }
}

function installShutdown(
  procs: ReturnType<typeof spawnTagged>[],
): void {
  const stop = (signal: NodeJS.Signals): void => {
    for (const p of procs) {
      try {
        p.kill(signal);
      } catch {
        // already gone
      }
    }
  };
  process.on("SIGINT", () => stop("SIGINT"));
  process.on("SIGTERM", () => stop("SIGTERM"));
}

function spawnTagged(spec: ChildSpec) {
  const proc = Bun.spawn(spec.cmd, {
    cwd: spec.cwd,
    stdout: "pipe",
    stderr: "pipe",
  });
  pipeWithPrefix(proc.stdout, spec, false);
  pipeWithPrefix(proc.stderr, spec, true);
  return proc;
}

async function pipeWithPrefix(
  stream: ReadableStream<Uint8Array>,
  spec: ChildSpec,
  toStderr: boolean,
): Promise<void> {
  const decoder = new TextDecoder();
  const reader = stream.getReader();
  const sink = toStderr ? Bun.stderr : Bun.stdout;
  const tag = `${spec.color}[${spec.label}]${RESET} `;
  let buffer = "";
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split("\n");
    buffer = lines.pop() ?? "";
    for (const line of lines) {
      sink.write(`${tag}${line}\n`);
      spec.onLine?.(stripAnsi(line));
    }
  }
  if (buffer.length > 0) {
    sink.write(`${tag}${buffer}\n`);
    spec.onLine?.(stripAnsi(buffer));
  }
}

function stripAnsi(s: string): string {
  return s.replace(/\x1b\[[0-9;]*m/g, "");
}

if (import.meta.main) {
  await main();
}
