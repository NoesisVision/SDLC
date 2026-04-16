import { Injectable, Inject, Logger, OnModuleInit } from "@nestjs/common";
import { readFile, readdir } from "fs/promises";
import { existsSync } from "fs";
import { join, relative } from "path";
import { SerenaService } from "../serena/serena.service.js";
import { PROJECT_DIR } from "../config/config.module.js";
import { ModelScanRepository } from "./model-scan.repository.js";
import {
  DDD_ANNOTATIONS,
  annotationToBlockType,
  type DddAnnotation,
  type NoesisConfig,
  type BoundedContextNode,
  type ModuleNode,
  type BuildingBlockNode,
  type ModelTree,
} from "./model-scan.types.js";

const CONCURRENCY_LIMIT = 10;

const DEFAULT_CONFIG: NoesisConfig = {
  namespacePartsToSkip: [],
  namespacesToExclude: [],
};

const ANNOTATION_WITH_TYPE_PATTERN = new RegExp(
  `\\[(${DDD_ANNOTATIONS.join("|")})(Attribute)?(?:\\s*\\(\\s*"([^"]*)"\\s*\\))?\\s*\\]` +
  `[\\s\\S]*?(?:class|struct|interface|enum|record|delegate)\\s+(\\w+)`,
  "g",
);

interface AnnotationMatch {
  annotation: DddAnnotation;
  nameOverride: string | null;
  typeName: string;
}

interface AnnotatedFile {
  relativePath: string;
  matches: AnnotationMatch[];
}

@Injectable()
export class ModelScanService implements OnModuleInit {
  private readonly logger = new Logger(ModelScanService.name);

  constructor(
    private readonly serena: SerenaService,
    private readonly repository: ModelScanRepository,
    @Inject(PROJECT_DIR) private readonly projectDir: string,
  ) {}

  async onModuleInit(): Promise<void> {
    await this.repository.initSchema();
  }

  async getModelTree(): Promise<ModelTree> {
    return this.repository.getModelTree();
  }

  async scan(): Promise<ModelTree> {
    this.logger.log("Starting model scan");
    const config = await loadNoesisConfig(this.projectDir);

    await this.repository.clearModel();

    const annotatedFiles = await this.findAnnotatedFiles();
    this.logger.log(`Found ${annotatedFiles.length} files with DDD annotations`);

    const blocks = await this.extractBuildingBlocks(annotatedFiles, config);
    this.logger.log(`Extracted ${blocks.length} building blocks`);

    const namespaces = [...new Set(blocks.map((b) => b.namespace).filter((ns) => ns !== ""))];
    const filteredNamespaces = filterNamespaces(namespaces, config);
    this.logger.log(`Found ${filteredNamespaces.length} unique namespaces`);

    const { boundedContexts, modules } = buildModuleHierarchy(filteredNamespaces, config);

    for (const bc of boundedContexts) {
      await this.repository.insertBoundedContext(bc);
    }
    for (const mod of modules) {
      await this.repository.insertModule(mod);
    }
    this.logger.log(
      `Created ${boundedContexts.length} bounded contexts and ${modules.length} modules`,
    );

    const allContainerPaths = [
      ...boundedContexts.map((bc) => bc.fullPath),
      ...modules.map((m) => m.fullPath),
    ].sort((a, b) => b.length - a.length);

    for (const bb of blocks) {
      const cleanedNs = removeSkippedParts(bb.namespace, config.namespacePartsToSkip);
      const containerPath = findContainer(cleanedNs, allContainerPaths);
      await this.repository.insertBuildingBlock({ ...bb, containerPath });
    }

    const tree = await this.repository.getModelTree();
    this.logger.log("Model scan completed");
    return tree;
  }

  private async findAnnotatedFiles(): Promise<AnnotatedFile[]> {
    const csFiles = await findCsFiles(this.projectDir);
    const results: AnnotatedFile[] = [];

    const batches = toBatches(csFiles, CONCURRENCY_LIMIT);
    for (const batch of batches) {
      const batchResults = await Promise.all(
        batch.map(async (absPath) => {
          const content = await readFile(absPath, "utf-8");
          const matches = parseAnnotations(content);
          if (matches.length === 0) return null;
          const relativePath = relative(this.projectDir, absPath);
          return { relativePath, matches };
        }),
      );
      for (const result of batchResults) {
        if (result !== null) results.push(result);
      }
    }

    return results;
  }

  private async extractBuildingBlocks(
    files: AnnotatedFile[],
    config: NoesisConfig,
  ): Promise<BuildingBlockNode[]> {
    const blocks: BuildingBlockNode[] = [];

    const batches = toBatches(files, CONCURRENCY_LIMIT);
    for (const batch of batches) {
      const batchResults = await Promise.all(
        batch.map((file) => this.extractFromFile(file, config)),
      );
      for (const fileBlocks of batchResults) {
        blocks.push(...fileBlocks);
      }
    }

    return blocks;
  }

  private async extractFromFile(
    file: AnnotatedFile,
    config: NoesisConfig,
  ): Promise<BuildingBlockNode[]> {
    const raw = await this.serena.callTool<unknown>("get_symbols_overview", {
      relative_path: file.relativePath,
      depth: 1,
    });

    const { namespace: rawNamespace } = parseOverviewResponse(raw);
    const cleanedNamespace = removeSkippedParts(rawNamespace, config.namespacePartsToSkip);

    const blocks: BuildingBlockNode[] = [];
    for (const match of file.matches) {
      const name = match.nameOverride ?? match.typeName;

      blocks.push({
        name,
        type: annotationToBlockType(match.annotation),
        annotation: match.annotation,
        namespace: cleanedNamespace,
        filePath: file.relativePath,
        containerPath: "",
      });
    }

    return blocks;
  }
}

function parseAnnotations(content: string): AnnotationMatch[] {
  const matches: AnnotationMatch[] = [];
  ANNOTATION_WITH_TYPE_PATTERN.lastIndex = 0;

  let match: RegExpExecArray | null;
  while ((match = ANNOTATION_WITH_TYPE_PATTERN.exec(content)) !== null) {
    const annotation = match[1] as DddAnnotation;
    const nameOverride = match[3] ?? null;
    const typeName = match[4] ?? "";
    if (typeName === "") continue;
    matches.push({ annotation, nameOverride, typeName });
  }

  return matches;
}

async function findCsFiles(dir: string): Promise<string[]> {
  const results: string[] = [];
  await walkDir(dir, results);
  return results;
}

async function walkDir(dir: string, results: string[]): Promise<void> {
  const entries = await readdir(dir, { withFileTypes: true });
  for (const entry of entries) {
    const fullPath = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (shouldSkipDir(entry.name)) continue;
      await walkDir(fullPath, results);
    } else if (entry.name.endsWith(".cs")) {
      results.push(fullPath);
    }
  }
}

function shouldSkipDir(name: string): boolean {
  return name === "node_modules" ||
    name === "bin" ||
    name === "obj" ||
    name === ".git" ||
    name === ".vs" ||
    name.startsWith(".");
}

async function loadNoesisConfig(projectDir: string): Promise<NoesisConfig> {
  const configPath = join(projectDir, "noesis-config.json");
  if (!existsSync(configPath)) {
    return DEFAULT_CONFIG;
  }
  const content = await readFile(configPath, "utf-8");
  const data = JSON.parse(content);
  return {
    namespacePartsToSkip: data.namespacePartsToSkip ?? [],
    namespacesToExclude: data.namespacesToExclude ?? [],
  };
}

function filterNamespaces(
  namespaces: string[],
  config: NoesisConfig,
): string[] {
  return [...new Set(
    namespaces
      .map((ns) => removeSkippedParts(ns, config.namespacePartsToSkip))
      .filter((ns) => ns !== "")
      .filter((ns) => !isExcluded(ns, config.namespacesToExclude)),
  )];
}

function removeSkippedParts(ns: string, partsToSkip: string[]): string {
  const parts = ns.split(".");
  const filtered = parts.filter((p) => !partsToSkip.includes(p));
  return filtered.join(".");
}

function isExcluded(ns: string, excludePatterns: string[]): boolean {
  return excludePatterns.some(
    (pattern) => ns === pattern || ns.startsWith(`${pattern}.`),
  );
}

function buildModuleHierarchy(
  namespaces: string[],
  config: NoesisConfig,
): { boundedContexts: BoundedContextNode[]; modules: ModuleNode[] } {
  const uniquePaths = new Set<string>();
  for (const ns of namespaces) {
    const parts = ns.split(".");
    for (let i = 1; i <= parts.length; i++) {
      uniquePaths.add(parts.slice(0, i).join("."));
    }
  }

  const sortedPaths = [...uniquePaths].sort();
  const boundedContexts: BoundedContextNode[] = [];
  const modules: ModuleNode[] = [];

  for (const path of sortedPaths) {
    if (isExcluded(path, config.namespacesToExclude)) continue;

    const parts = path.split(".");
    const name = parts[parts.length - 1];

    if (parts.length === 1) {
      boundedContexts.push({ name, fullPath: path });
    } else {
      const parentPath = parts.slice(0, -1).join(".");
      modules.push({ name, fullPath: path, parentPath });
    }
  }

  return { boundedContexts, modules };
}

function toBatches<T>(items: T[], size: number): T[][] {
  const batches: T[][] = [];
  for (let i = 0; i < items.length; i += size) {
    batches.push(items.slice(i, i + size));
  }
  return batches;
}

function findContainer(namespace: string, containerPaths: string[]): string {
  return containerPaths.find((p) => namespace.startsWith(p)) ?? "";
}

/**
 * Parses Serena's get_symbols_overview response.
 *
 * Format examples:
 *   {"Namespace":[{"MyCompany.Foo":{"Class":["Bar","Baz"],"Interface":["Qux"]}}]}
 *   {"Namespace":["MyCompany.Foo"]}
 */
function parseOverviewResponse(raw: unknown): { namespace: string; typeNames: string[] } {
  if (typeof raw !== "object" || raw === null) {
    return { namespace: "", typeNames: [] };
  }

  const obj = raw as Record<string, unknown>;
  const nsEntries = obj["Namespace"];
  if (!Array.isArray(nsEntries) || nsEntries.length === 0) {
    return { namespace: "", typeNames: [] };
  }

  const first = nsEntries[0];

  if (typeof first === "string") {
    return { namespace: first, typeNames: [] };
  }

  if (typeof first === "object" && first !== null) {
    const nsObj = first as Record<string, unknown>;
    const nsName = Object.keys(nsObj)[0] ?? "";
    const kindMap = nsObj[nsName];

    const typeNames: string[] = [];
    if (typeof kindMap === "object" && kindMap !== null) {
      for (const names of Object.values(kindMap as Record<string, unknown>)) {
        if (Array.isArray(names)) {
          typeNames.push(...(names as string[]));
        }
      }
    }

    return { namespace: nsName, typeNames };
  }

  return { namespace: "", typeNames: [] };
}
