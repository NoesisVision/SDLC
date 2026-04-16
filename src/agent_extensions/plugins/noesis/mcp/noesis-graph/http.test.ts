import { describe, test, expect, afterEach, beforeEach } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { startHttpServer, type HttpServerHandle } from "./http.js";

describe("http server", () => {
  let tmpDir: string;
  let server: HttpServerHandle;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "noesis-http-test-"));
  });

  afterEach(() => {
    server?.stop();
    rmSync(tmpDir, { recursive: true, force: true });
  });

  test("health endpoint returns ok", async () => {
    server = startHttpServer({ staticDir: tmpDir });
    const res = await fetch(`http://localhost:${server.port}/api/health`);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ status: "ok" });
  });

  test("serves static index.html at root", async () => {
    writeFileSync(join(tmpDir, "index.html"), "<html><body>Hello</body></html>");
    server = startHttpServer({ staticDir: tmpDir });
    const res = await fetch(`http://localhost:${server.port}/`);
    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toBe("text/html");
    expect(await res.text()).toContain("Hello");
  });

  test("serves static files by path", async () => {
    mkdirSync(join(tmpDir, "assets"), { recursive: true });
    writeFileSync(join(tmpDir, "assets", "style.css"), "body { color: red; }");
    server = startHttpServer({ staticDir: tmpDir });
    const res = await fetch(`http://localhost:${server.port}/assets/style.css`);
    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toBe("text/css");
    expect(await res.text()).toContain("color: red");
  });

  test("falls back to index.html for unknown routes", async () => {
    writeFileSync(join(tmpDir, "index.html"), "<html>SPA</html>");
    server = startHttpServer({ staticDir: tmpDir });
    const res = await fetch(`http://localhost:${server.port}/some/route`);
    expect(res.status).toBe(200);
    expect(await res.text()).toContain("SPA");
  });

  test("returns 404 when no index.html exists", async () => {
    server = startHttpServer({ staticDir: tmpDir });
    const res = await fetch(`http://localhost:${server.port}/missing`);
    expect(res.status).toBe(404);
  });

  test("blocks path traversal", async () => {
    server = startHttpServer({ staticDir: tmpDir });
    const res = await fetch(`http://localhost:${server.port}/../../../etc/passwd`);
    expect(res.status).not.toBe(200);
  });
});
