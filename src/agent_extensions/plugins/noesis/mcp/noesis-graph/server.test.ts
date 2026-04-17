import { describe, test, expect, afterEach } from "bun:test";
import { mkdtempSync, rmSync } from "fs";
import { join, resolve } from "path";
import { tmpdir } from "os";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const SERVER_PATH = resolve(import.meta.dirname, "server.ts");
const PLUGIN_ROOT = resolve(import.meta.dirname, "../..");

describe("MCP server smoke test", () => {
  let tmpDir: string;
  let projectDir: string;
  let client: Client | null = null;
  let transport: StdioClientTransport | null = null;

  afterEach(async () => {
    if (client) {
      await client.close().catch(() => {});
      client = null;
    }
    if (transport) {
      await transport.close().catch(() => {});
      transport = null;
    }
    if (tmpDir) {
      rmSync(tmpDir, { recursive: true, force: true });
    }
    if (projectDir) {
      rmSync(projectDir, { recursive: true, force: true });
    }
  });

  test("responds to MCP initialize and reports server info", async () => {
    tmpDir = mkdtempSync(join(tmpdir(), "noesis-smoke-"));

    projectDir = mkdtempSync(join(tmpdir(), "noesis-project-"));

    transport = new StdioClientTransport({
      command: "bun",
      args: ["run", SERVER_PATH, tmpDir, projectDir],
      cwd: PLUGIN_ROOT,
      env: {
        ...process.env,
        DISPLAY: "",
      } as Record<string, string>,
    });

    client = new Client({ name: "smoke-test", version: "1.0.0" });
    await client.connect(transport);

    const serverInfo = client.getServerVersion();
    expect(serverInfo).toBeDefined();
    expect(serverInfo!.name).toBe("noesis");
    expect(serverInfo!.version).toBe("0.1.0");

    const tools = await client.listTools();
    expect(tools.tools.map((t) => t.name)).toContain("get_domain_model");
  }, 15000);
});
