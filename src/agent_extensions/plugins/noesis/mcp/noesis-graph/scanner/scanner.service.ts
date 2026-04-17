import { Injectable, Inject, Logger, OnModuleInit } from "@nestjs/common";
import { readFile, readdir } from "fs/promises";
import { existsSync } from "fs";
import { join, relative } from "path";
import { PROJECT_DIR } from "../config/config.module.js";
import { ScannerRepository } from "./scanner.repository.js";
import {
  DDD_ANNOTATIONS,
  annotationToBlockType,
  type DddAnnotation,
  type NoesisConfig,
  type BoundedContext,
  type Module,
  type BuildingBlock,
  type CSharpNamespace,
  type CSharpType,
  type ModelTree,
} from "./scanner.types.js";

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

const NAMESPACE_PATTERN = /^\s*namespace\s+([\w.]+)\s*[;{]/m;

interface AnnotationMatch {
  annotation: DddAnnotation;
  nameOverride: string | null;
  typeName: string;
}

interface ScannedFile {
  relativePath: string;
  namespace: string;
  matches: AnnotationMatch[];
}

interface KeptFile {
  relativePath: string;
  rawNamespace: string;
  namespace: string;
  matches: AnnotationMatch[];
}

@Injectable()
export class ScannerService implements OnModuleInit {
  private readonly logger = new Logger(ScannerService.name);

  constructor(
    private readonly repository: ScannerRepository,
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

    const scannedFiles = await this.scanCsFiles();
    this.logger.log(`Scanned ${scannedFiles.length} C# files`);

    const notExcluded = scannedFiles.filter(
      (f) => f.namespace !== "" && !isExcluded(f.namespace, config.namespacesToExclude),
    );

    const keptFiles: KeptFile[] = notExcluded
      .map((f) => ({
        relativePath: f.relativePath,
        rawNamespace: f.namespace,
        namespace: removeSkippedParts(f.namespace, config.namespacePartsToSkip),
        matches: f.matches,
      }))
      .filter((f) => f.namespace !== "");

    const effectiveNamespaces = [...new Set(keptFiles.map((f) => f.namespace))];
    this.logger.log(`Found ${effectiveNamespaces.length} unique domain paths`);

    const { boundedContexts, modules } = buildModuleHierarchy(effectiveNamespaces);
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

    const bcPaths = new Set(boundedContexts.map((bc) => bc.fullPath));
    const namespacesPerContainer = groupRawNamespacesByContainer(keptFiles, allContainerPaths);

    for (const rawNs of new Set(keptFiles.map((f) => f.rawNamespace))) {
      await this.repository.insertCSharpNamespace(toCSharpNamespace(rawNs));
    }

    for (const [containerPath, rawNamespaces] of namespacesPerContainer) {
      for (const rawNs of rawNamespaces) {
        if (bcPaths.has(containerPath)) {
          await this.repository.linkBoundedContextToCSharpNamespace(containerPath, rawNs);
        } else {
          await this.repository.linkModuleToCSharpNamespace(containerPath, rawNs);
        }
      }
    }

    let blockCount = 0;
    for (const file of keptFiles) {
      const containerPath = findContainer(file.namespace, allContainerPaths);
      for (const match of file.matches) {
        const csharpType: CSharpType = {
          id: `${file.relativePath}:${match.typeName}`,
          name: match.typeName,
          fullName: `${file.rawNamespace}.${match.typeName}`,
          filePath: file.relativePath,
        };
        await this.repository.insertCSharpType(csharpType, file.rawNamespace);

        const blockName = match.nameOverride ?? match.typeName;
        const block: BuildingBlock = {
          id: `${file.relativePath}:${blockName}`,
          name: blockName,
          type: annotationToBlockType(match.annotation),
          annotation: match.annotation,
        };
        await this.repository.insertBuildingBlock(block, containerPath, csharpType.id);
        blockCount++;
      }
    }
    this.logger.log(`Inserted ${blockCount} building blocks`);

    const tree = await this.repository.getModelTree();
    this.logger.log("Model scan completed");
    return tree;
  }

  private async scanCsFiles(): Promise<ScannedFile[]> {
    const csFiles = await findCsFiles(this.projectDir);
    const results: ScannedFile[] = [];

    const batches = toBatches(csFiles, CONCURRENCY_LIMIT);
    for (const batch of batches) {
      const batchResults = await Promise.all(
        batch.map(async (absPath) => {
          const content = await readFile(absPath, "utf-8");
          const namespace = extractNamespace(content) ?? "";
          const matches = parseAnnotations(content);
          const relativePath = relative(this.projectDir, absPath);
          return { relativePath, namespace, matches };
        }),
      );
      results.push(...batchResults);
    }

    return results;
  }
}

export function removeSkippedParts(ns: string, partsToSkip: string[]): string {
  if (ns === "") return "";
  let parts = ns.split(".");
  for (const pattern of partsToSkip) {
    if (pattern === "") continue;
    parts = removeContiguousSequence(parts, pattern.split("."));
  }
  return parts.join(".");
}

function removeContiguousSequence(parts: string[], sequence: string[]): string[] {
  const result: string[] = [];
  let i = 0;
  while (i < parts.length) {
    if (matchesAt(parts, i, sequence)) {
      i += sequence.length;
    } else {
      result.push(parts[i]);
      i++;
    }
  }
  return result;
}

function matchesAt(parts: string[], start: number, sequence: string[]): boolean {
  if (start + sequence.length > parts.length) return false;
  for (let j = 0; j < sequence.length; j++) {
    if (parts[start + j] !== sequence[j]) return false;
  }
  return true;
}

export function isExcluded(ns: string, excludePatterns: string[]): boolean {
  return excludePatterns.some((pattern) => pattern !== "" && matchesNamespacePattern(ns, pattern));
}

function matchesNamespacePattern(ns: string, pattern: string): boolean {
  const nsParts = ns.split(".");
  const patternParts = pattern.split(".");
  return matchPatternParts(patternParts, 0, nsParts, 0);
}

function matchPatternParts(
  patternParts: string[],
  pi: number,
  nsParts: string[],
  ni: number,
): boolean {
  if (pi === patternParts.length) return ni === nsParts.length;
  const token = patternParts[pi];
  if (token === "*") {
    for (let k = 0; k <= nsParts.length - ni; k++) {
      if (matchPatternParts(patternParts, pi + 1, nsParts, ni + k)) return true;
    }
    return false;
  }
  if (ni === nsParts.length) return false;
  if (token !== nsParts[ni]) return false;
  return matchPatternParts(patternParts, pi + 1, nsParts, ni + 1);
}

export function extractNamespace(content: string): string | null {
  const match = NAMESPACE_PATTERN.exec(content);
  return match ? match[1] : null;
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

export function buildModuleHierarchy(
  namespaces: string[],
): { boundedContexts: BoundedContext[]; modules: Module[] } {
  const uniquePaths = new Set<string>();
  for (const ns of namespaces) {
    const parts = ns.split(".");
    for (let i = 1; i <= parts.length; i++) {
      uniquePaths.add(parts.slice(0, i).join("."));
    }
  }

  const sortedPaths = [...uniquePaths].sort();
  const boundedContexts: BoundedContext[] = [];
  const modules: Module[] = [];

  for (const path of sortedPaths) {
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

function findContainer(namespace: string, containerPaths: string[]): string {
  return containerPaths.find((p) => namespace.startsWith(p)) ?? "";
}

function groupRawNamespacesByContainer(
  files: KeptFile[],
  containerPaths: string[],
): Map<string, Set<string>> {
  const map = new Map<string, Set<string>>();
  for (const file of files) {
    const containerPath = findContainer(file.namespace, containerPaths);
    if (containerPath === "") continue;
    const set = map.get(containerPath) ?? new Set<string>();
    set.add(file.rawNamespace);
    map.set(containerPath, set);
  }
  return map;
}

function toCSharpNamespace(fullName: string): CSharpNamespace {
  const parts = fullName.split(".");
  return { name: parts[parts.length - 1], fullName };
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

function toBatches<T>(items: T[], size: number): T[][] {
  const batches: T[][] = [];
  for (let i = 0; i < items.length; i += size) {
    batches.push(items.slice(i, i + size));
  }
  return batches;
}
