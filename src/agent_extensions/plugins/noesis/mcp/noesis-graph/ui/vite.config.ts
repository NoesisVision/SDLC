import { defineConfig, type Plugin } from "vite";
import react from "@vitejs/plugin-react";
import http from "node:http";
import https from "node:https";
import { readDiscovery } from "../dev/dev-discovery.js";

export default defineConfig({
  plugins: [react(), noesisApiProxy()],
  build: {
    outDir: "dist",
  },
});

function noesisApiProxy(): Plugin {
  return {
    name: "noesis-api-proxy",
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        if (req.url === undefined || !req.url.startsWith("/api")) {
          next();
          return;
        }
        const discovery = readDiscovery();
        if (discovery === null) {
          res.statusCode = 503;
          res.setHeader("Content-Type", "text/plain");
          res.end(
            "Noesis dev backend not running. Start it with: bun run dev:backend",
          );
          return;
        }
        const targetUrl = new URL(req.url, discovery.url);
        const client = targetUrl.protocol === "https:" ? https : http;
        const proxyReq = client.request(
          targetUrl,
          {
            method: req.method,
            headers: { ...req.headers, host: targetUrl.host },
          },
          (proxyRes) => {
            res.statusCode = proxyRes.statusCode ?? 502;
            for (const [name, value] of Object.entries(proxyRes.headers)) {
              if (value !== undefined) {
                res.setHeader(name, value);
              }
            }
            proxyRes.pipe(res);
          },
        );
        proxyReq.on("error", (err) => {
          res.statusCode = 502;
          res.setHeader("Content-Type", "text/plain");
          res.end(`Noesis dev backend unreachable: ${err.message}`);
        });
        req.pipe(proxyReq);
      });
    },
  };
}
