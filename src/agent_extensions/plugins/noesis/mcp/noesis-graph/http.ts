import { join } from "path";
import { statSync, readFileSync } from "fs";
import { getSerenaState } from "./serena.js";


export interface HttpServerConfig {
  staticDir: string;
  port?: number;
}

export interface HttpServerHandle {
  port: number;
  stop: () => void;
}

const CONTENT_TYPES: Record<string, string> = {
  ".html": "text/html",
  ".js": "application/javascript",
  ".css": "text/css",
  ".json": "application/json",
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
};

export function startHttpServer(config: HttpServerConfig): HttpServerHandle {
  const server = Bun.serve({
    port: config.port ?? 0,
    fetch(req) {
      return handleRequest(req, config.staticDir);
    },
  });

  return {
    port: server.port!,
    stop: () => server.stop(true),
  };
}

function handleRequest(req: Request, staticDir: string): Response {
  const url = new URL(req.url);

  if (url.pathname === "/api/health") {
    return Response.json({ status: "ok" });
  }

  if (url.pathname === "/api/serena/status") {
    return Response.json(getSerenaState());
  }

  return serveStaticFile(url.pathname, staticDir);
}

function serveStaticFile(pathname: string, staticDir: string): Response {
  const filePath = pathname === "/" ? "/index.html" : pathname;
  const fullPath = join(staticDir, filePath);

  if (!fullPath.startsWith(staticDir)) {
    return new Response("Forbidden", { status: 403 });
  }

  try {
    const stat = statSync(fullPath);
    if (!stat.isFile()) {
      return serveFallback(staticDir);
    }

    const content = readFileSync(fullPath);
    const ext = filePath.substring(filePath.lastIndexOf("."));
    const contentType = CONTENT_TYPES[ext] ?? "application/octet-stream";

    return new Response(content, {
      headers: { "Content-Type": contentType },
    });
  } catch {
    return serveFallback(staticDir);
  }
}

function serveFallback(staticDir: string): Response {
  try {
    const indexPath = join(staticDir, "index.html");
    const content = readFileSync(indexPath);
    return new Response(content, {
      headers: { "Content-Type": "text/html" },
    });
  } catch {
    return new Response("Not Found", { status: 404 });
  }
}
