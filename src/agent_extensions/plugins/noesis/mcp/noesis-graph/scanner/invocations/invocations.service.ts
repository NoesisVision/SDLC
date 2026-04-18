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
    const edges = await computeInvocations({
      behaviors,
      inv,
      inheritance,
      serena: this.asSerenaLike(),
    });
    await this.repo.clearInvocations();
    for (const edge of edges) {
      await this.repo.insertInvocation(edge);
    }
    this.logger.log(`Inserted ${edges.length} behavior invocations`);
    return edges;
  }

  private asSerenaLike(): SerenaLike {
    return {
      findReferencingSymbols: async (namePath, relativePath) => {
        const response = await this.serena.callTool<SerenaRefsResponse>(
          "find_referencing_symbols",
          { name_path: namePath, relative_path: relativePath },
        );
        return response.map(toSerenaReference);
      },
    };
  }
}

interface SerenaRefsResponseEntry {
  name_path?: string;
  relative_path?: string;
  kind?: number;
}

type SerenaRefsResponse = SerenaRefsResponseEntry[];

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
