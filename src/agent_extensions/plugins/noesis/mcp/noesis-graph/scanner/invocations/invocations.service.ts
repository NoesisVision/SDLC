import { Injectable, Logger, OnModuleInit } from "@nestjs/common";
import { SerenaService } from "../../serena/serena.service.js";
import { ScannerRepository } from "../scanner.repository.js";
import { InvocationsRepository } from "./invocations.repository.js";
import {
  computeInvocations,
  type BehaviorInventory,
} from "./invocations.algorithm.js";
import type { InheritanceMap } from "../inheritance/inheritance.types.js";
import type {
  BehaviorRow,
  Invocation,
  SerenaLike,
  SerenaReference,
} from "./invocations.types.js";

@Injectable()
export class InvocationsService implements OnModuleInit {
  private readonly logger = new Logger(InvocationsService.name);

  constructor(
    private readonly scannerRepo: ScannerRepository,
    private readonly repo: InvocationsRepository,
    private readonly serena: SerenaService,
  ) {}

  async getBehaviorInvocations(filter?: {
    sourceBehaviorId?: string;
    destinationBehaviorId?: string;
  }): Promise<Invocation[]> {
    return this.repo.getInvocations(filter);
  }

  async onModuleInit(): Promise<void> {
    await this.scannerRepo.initSchema();
    await this.repo.initSchema();
  }

  async rebuildInvocations(inheritance: InheritanceMap): Promise<Invocation[]> {
    const behaviors = await this.scannerRepo.getBehaviorsWithLocations();
    const inv = buildInventory(behaviors);
    this.logger.log(
      `Computing invocations for ${behaviors.length} behaviors`,
    );
    const edges = await computeInvocations({
      behaviors,
      inv,
      inheritance,
      serena: this.asSerenaLike(),
      onProgress: (done, total, edgesSoFar) => {
        this.logger.log(
          `Invocations progress: ${done}/${total} behaviors, ${edgesSoFar} edges`,
        );
      },
    });
    await this.repo.clearInvocations();
    for (const edge of edges) {
      await this.repo.insertInvocation(edge);
    }
    this.logger.log(`Inserted ${edges.length} behavior invocations`);
    return edges;
  }

  private asSerenaLike(): SerenaLike {
    const cache = new Map<string, Promise<SerenaReference[]>>();
    return {
      findReferencingSymbols: (namePath, relativePath) => {
        const key = `${namePath}||${relativePath}`;
        const existing = cache.get(key);
        if (existing !== undefined) return existing;
        const fresh = this.fetchReferences(namePath, relativePath);
        cache.set(key, fresh);
        return fresh;
      },
    };
  }

  private async fetchReferences(
    namePath: string,
    relativePath: string,
  ): Promise<SerenaReference[]> {
    try {
      const entries = await this.callFindReferences(namePath, relativePath);
      return entries.map(toSerenaReference);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      const overloadCount = detectOverloadCount(message);
      if (overloadCount !== null) {
        return this.fetchReferencesForOverloads(
          namePath,
          relativePath,
          overloadCount,
        );
      }
      this.logger.warn(
        `Skipping references for ${namePath} in ${relativePath}: ${message}`,
      );
      return [];
    }
  }

  private async fetchReferencesForOverloads(
    namePath: string,
    relativePath: string,
    count: number,
  ): Promise<SerenaReference[]> {
    const results: SerenaReference[] = [];
    for (let index = 0; index < count; index++) {
      const disambiguated = `${namePath}[${index}]`;
      try {
        const entries = await this.callFindReferences(
          disambiguated,
          relativePath,
        );
        for (const entry of entries) {
          results.push(toSerenaReference(entry));
        }
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err);
        this.logger.warn(
          `Skipping overload references for ${disambiguated} in ${relativePath}: ${message}`,
        );
      }
    }
    return results;
  }

  private async callFindReferences(
    namePath: string,
    relativePath: string,
  ): Promise<SerenaRefsResponseEntry[]> {
    const raw = await withTimeout(
      this.serena.callTool<unknown>(
        "find_referencing_symbols",
        { name_path: namePath, relative_path: relativePath },
      ),
      SERENA_CALL_TIMEOUT_MS,
      `find_referencing_symbols ${namePath} in ${relativePath}`,
    );
    const entries = normalizeRefs(raw);
    if (entries === null) {
      this.logger.warn(
        `Unexpected Serena response shape for ${namePath} in ${relativePath}: ${describeShape(raw)}`,
      );
      return [];
    }
    return entries;
  }
}

const SERENA_CALL_TIMEOUT_MS = 60_000;

function withTimeout<T>(
  promise: Promise<T>,
  timeoutMs: number,
  label: string,
): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error(`timed out after ${timeoutMs}ms (${label})`));
    }, timeoutMs);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (err: unknown) => {
        clearTimeout(timer);
        reject(err instanceof Error ? err : new Error(String(err)));
      },
    );
  });
}

interface SerenaRefsResponseEntry {
  name_path?: string;
  relative_path?: string;
  kind?: number;
  [key: string]: unknown;
}

export function detectOverloadCount(message: string): number | null {
  const match = /Found multiple (\d+) symbols matching/.exec(message);
  if (match === null) return null;
  const count = Number(match[1]);
  return Number.isFinite(count) && count > 0 ? count : null;
}

export function normalizeRefs(
  raw: unknown,
): SerenaRefsResponseEntry[] | null {
  if (raw === null || raw === undefined) return [];
  if (Array.isArray(raw)) return raw as SerenaRefsResponseEntry[];
  if (typeof raw === "object") {
    const obj = raw as Record<string, unknown>;
    for (const field of ["references", "results", "symbols"]) {
      const candidate = obj[field];
      if (Array.isArray(candidate)) {
        return candidate as SerenaRefsResponseEntry[];
      }
    }
    return flattenFileGroupedRefs(obj);
  }
  return null;
}

function flattenFileGroupedRefs(
  obj: Record<string, unknown>,
): SerenaRefsResponseEntry[] | null {
  if (Object.keys(obj).length === 0) return [];
  const entries: SerenaRefsResponseEntry[] = [];
  for (const [filePath, value] of Object.entries(obj)) {
    if (!collectRefsFromNode(value, filePath, entries)) return null;
  }
  return entries;
}

function collectRefsFromNode(
  node: unknown,
  currentFilePath: string,
  out: SerenaRefsResponseEntry[],
): boolean {
  if (node === null || node === undefined) return true;
  if (Array.isArray(node)) {
    for (const item of node) {
      if (!collectRefsFromNode(item, currentFilePath, out)) return false;
    }
    return true;
  }
  if (typeof node === "object") {
    const obj = node as Record<string, unknown>;
    if (typeof obj.name_path === "string") {
      const ref = obj as SerenaRefsResponseEntry;
      out.push({
        ...ref,
        relative_path:
          typeof ref.relative_path === "string"
            ? ref.relative_path
            : currentFilePath,
      });
      return true;
    }
    for (const value of Object.values(obj)) {
      if (!collectRefsFromNode(value, currentFilePath, out)) return false;
    }
    return true;
  }
  if (typeof node === "string") {
    out.push({ name_path: node, relative_path: currentFilePath });
    return true;
  }
  return false;
}

function describeShape(raw: unknown): string {
  if (raw === null) return "null";
  if (Array.isArray(raw)) return "array";
  if (typeof raw === "object") {
    const entries = Object.entries(raw as Record<string, unknown>).slice(0, 3);
    const summary = entries
      .map(([k, v]) => `${k}: ${describeValue(v)}`)
      .join(", ");
    return `object{${summary}}`;
  }
  return typeof raw;
}

function describeValue(value: unknown): string {
  if (value === null) return "null";
  if (Array.isArray(value)) {
    const first = value.length > 0 ? describeValue(value[0]) : "";
    return `array[${value.length}${first !== "" ? `, first=${first}` : ""}]`;
  }
  if (typeof value === "object") {
    const keys = Object.keys(value as object).slice(0, 4).join(",");
    return `object{${keys}}`;
  }
  if (typeof value === "string") {
    const preview = value.length > 60 ? `${value.slice(0, 60)}…` : value;
    return `string(${JSON.stringify(preview)})`;
  }
  return typeof value;
}

function buildInventory(rows: BehaviorRow[]): BehaviorInventory {
  const byLocation = new Map<string, BehaviorRow>();
  const byTypeMethod = new Map<string, BehaviorRow[]>();
  for (const r of rows) {
    byLocation.set(`${r.filePath}:${r.typeName}:${r.methodName}`, r);
    const key = `${r.typeName}:${r.methodName}`;
    const list = byTypeMethod.get(key) ?? [];
    list.push(r);
    byTypeMethod.set(key, list);
  }
  return { byLocation, byTypeMethod };
}

function toSerenaReference(entry: SerenaRefsResponseEntry): SerenaReference {
  if (!entry.name_path || !entry.relative_path) return { enclosing: null };
  const parts = entry.name_path.split("/").filter((p) => p !== "");
  if (parts.length < 2) return { enclosing: null };
  const methodName = parts[parts.length - 1];
  const typeName = parts[parts.length - 2];
  return {
    enclosing: {
      filePath: entry.relative_path,
      typeName,
      methodName,
    },
  };
}
