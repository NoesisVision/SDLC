import { existsSync, readFileSync, unlinkSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";

export interface DevServerDiscovery {
  url: string;
  pid: number;
  startedAt: string;
}

export const DISCOVERY_FILE = join(tmpdir(), "noesis-graph-dev-server.json");

export function readDiscovery(): DevServerDiscovery | null {
  if (!existsSync(DISCOVERY_FILE)) return null;
  try {
    const raw = readFileSync(DISCOVERY_FILE, "utf-8");
    const parsed = JSON.parse(raw) as Partial<DevServerDiscovery>;
    if (
      typeof parsed.url !== "string" ||
      typeof parsed.pid !== "number" ||
      typeof parsed.startedAt !== "string"
    ) {
      return null;
    }
    return { url: parsed.url, pid: parsed.pid, startedAt: parsed.startedAt };
  } catch {
    return null;
  }
}

export function writeDiscovery(discovery: DevServerDiscovery): void {
  writeFileSync(DISCOVERY_FILE, JSON.stringify(discovery, null, 2), "utf-8");
}

export function clearDiscovery(): void {
  if (existsSync(DISCOVERY_FILE)) {
    try {
      unlinkSync(DISCOVERY_FILE);
    } catch {
      // best-effort cleanup
    }
  }
}
