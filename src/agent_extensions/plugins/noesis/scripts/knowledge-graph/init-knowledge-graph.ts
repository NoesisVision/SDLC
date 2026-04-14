import { existsSync, mkdirSync } from "fs";
import { dirname } from "path";
import { outputResult, parseArgs } from "../io.js";

export function initKnowledgeGraph(path: string): void {
  mkdirSync(dirname(path), { recursive: true });
  const kg = { conversations: [], topics: [], decisions: [] };
  Bun.write(path, JSON.stringify(kg, null, 2));
}

// --- Entry point ---

async function main(): Promise<void> {
  const args = parseArgs(["knowledge_graph_path"]);
  const path = args["knowledge_graph_path"];

  if (existsSync(path)) {
    outputResult({ status: "AlreadyExists", path });
    return;
  }

  initKnowledgeGraph(path);
  outputResult({ status: "Ok", path });
}

if (import.meta.main) {
  main();
}
