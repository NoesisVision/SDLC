import { Injectable, Inject, Logger, OnModuleInit, Optional } from "@nestjs/common";
import { readFile } from "fs/promises";
import { existsSync } from "fs";
import { join } from "path";
import { PROJECT_DIR } from "../config/config.module.js";
import { ScannerRepository } from "./scanner.repository.js";
import { InvocationsService } from "./invocations/invocations.service.js";
import { extractInheritanceMap } from "./inheritance/inheritance.js";
import type { NoesisConfig } from "./scanner-config.js";
import type { CodeNamespace, CodeType } from "./code-structure.js";
import { csharpScanner } from "./csharp/csharp-scanner.js";
import { javaScanner } from "./java/java-scanner.js";
import type { Language, LanguageScanner, ScannedFile } from "./language-scanner.js";
import {
  buildModuleHierarchy,
  findContainer,
  isExcluded,
  removeSkippedParts,
} from "./namespace-hierarchy.js";
import {
  parentPathOf,
  type Behavior,
  type BoundedContext,
  type BoundedContextBranch,
  type BuildingBlock,
  type BuildingBlockBranch,
  type DomainModelTree,
  type Module,
  type ModuleBranch,
} from "./domain-model/domain-model.js";

// Temporary flag: keep the invocations analysis code wired in, but skip it at
// runtime so scans are fast and do not require Serena.
const INVOCATIONS_ANALYSIS_ENABLED: boolean = false;

/** Every language the scanner knows; a project is scanned in each one it has sources of. */
export const LANGUAGE_SCANNERS: readonly LanguageScanner[] = [csharpScanner, javaScanner];

/** Injection token for overriding the scanner set, in tests. */
export const LANGUAGE_SCANNERS_TOKEN = "LANGUAGE_SCANNERS";

const DEFAULT_CONFIG: NoesisConfig = {
  namespacePartsToSkip: [],
  namespacesToExclude: [],
};

/** A scanned file whose namespace survived the exclusions, with the skips applied. */
interface KeptFile {
  language: Language;
  relativePath: string;
  rawNamespace: string;
  namespace: string;
  types: ScannedFile["types"];
  content: string;
}

interface ScannedModel {
  keptFiles: KeptFile[];
  boundedContexts: BoundedContext[];
  modules: Module[];
  /** Bounded context names and module paths, longest first, so the deepest container matches first. */
  allContainerPaths: string[];
}

export type DomainModelPart = DomainModelTree | BoundedContextBranch | ModuleBranch;

@Injectable()
export class ScannerService implements OnModuleInit {
  private readonly logger = new Logger(ScannerService.name);
  private readonly scanners: readonly LanguageScanner[];

  constructor(
    private readonly repository: ScannerRepository,
    private readonly invocations: InvocationsService,
    @Inject(PROJECT_DIR) private readonly projectDir: string,
    @Optional() @Inject(LANGUAGE_SCANNERS_TOKEN) scanners?: readonly LanguageScanner[]
  ) {
    this.scanners = scanners ?? LANGUAGE_SCANNERS;
  }

  async onModuleInit(): Promise<void> {
    await this.repository.initSchema();
  }

  async getDomainModel(): Promise<DomainModelTree> {
    return this.repository.getDomainModel();
  }

  async getDomainModelPart(filter: {
    boundedContextName?: string;
    modulePath?: string;
  }): Promise<DomainModelPart> {
    if (filter.boundedContextName && filter.modulePath) {
      throw new Error("Pass at most one of boundedContextName or modulePath");
    }

    const tree = await this.repository.getDomainModel();

    if (filter.modulePath !== undefined) {
      const found = findModuleByPath(tree, filter.modulePath);
      if (!found) throw new Error(`Module not found: ${filter.modulePath}`);
      return found;
    }

    if (filter.boundedContextName !== undefined) {
      const found = tree.boundedContexts.find((bc) => bc.name === filter.boundedContextName);
      if (!found) throw new Error(`Bounded context not found: ${filter.boundedContextName}`);
      return found;
    }

    return tree;
  }

  /** The languages the project has sources of, in scanner order. */
  async detectLanguages(): Promise<Language[]> {
    const detected: Language[] = [];
    for (const scanner of this.scanners) {
      if (await scanner.detect(this.projectDir)) detected.push(scanner.language);
    }
    return detected;
  }

  async scanInMemory(): Promise<DomainModelTree> {
    const { keptFiles, boundedContexts, modules, allContainerPaths } =
      await this.collectScannedModel();
    return assembleDomainTree(boundedContexts, modules, keptFiles, allContainerPaths);
  }

  async scan(): Promise<DomainModelTree> {
    this.logger.log("Starting model scan");
    await this.repository.clearModel();

    const { keptFiles, boundedContexts, modules, allContainerPaths } =
      await this.collectScannedModel();

    for (const bc of boundedContexts) {
      await this.repository.insertBoundedContext(bc);
    }
    for (const mod of modules) {
      await this.repository.insertModule(mod);
    }
    this.logger.log(
      `Created ${boundedContexts.length} bounded contexts and ${modules.length} modules`
    );

    await this.insertCodeNamespaces(keptFiles, boundedContexts, allContainerPaths);
    await this.insertBuildingBlocks(keptFiles, allContainerPaths);

    if (INVOCATIONS_ANALYSIS_ENABLED) {
      this.logger.log("Starting invocations analysis");
      const inheritance = extractInheritanceMap(
        keptFiles
          .filter((f) => f.language === "csharp")
          .map((f) => ({ relativePath: f.relativePath, content: f.content }))
      );
      await this.invocations.rebuildInvocations(inheritance);
    }

    const tree = await this.repository.getDomainModel();
    this.logger.log("Model scan completed");
    return tree;
  }

  private async collectScannedModel(): Promise<ScannedModel> {
    const config = await loadNoesisConfig(this.projectDir);
    const scannedFiles = await this.scanDetectedLanguages();

    const keptFiles: KeptFile[] = scannedFiles
      .filter((f) => f.namespace !== "" && !isExcluded(f.namespace, config.namespacesToExclude))
      .map((f) => ({
        language: f.language,
        relativePath: f.relativePath,
        rawNamespace: f.namespace,
        namespace: removeSkippedParts(f.namespace, config.namespacePartsToSkip),
        types: f.types,
        content: f.content,
      }))
      .filter((f) => f.namespace !== "");

    const effectiveNamespaces = [...new Set(keptFiles.map((f) => f.namespace))];
    this.logger.log(`Found ${effectiveNamespaces.length} unique domain paths`);

    const { boundedContexts, modules } = buildModuleHierarchy(effectiveNamespaces);
    const allContainerPaths = [
      ...boundedContexts.map((bc) => bc.name),
      ...modules.map((m) => m.fullPath),
    ].sort((a, b) => b.length - a.length);

    return { keptFiles, boundedContexts, modules, allContainerPaths };
  }

  private async scanDetectedLanguages(): Promise<ScannedFile[]> {
    const files: ScannedFile[] = [];
    for (const scanner of this.scanners) {
      if (!(await scanner.detect(this.projectDir))) continue;
      const scanned = await scanner.scan(this.projectDir);
      this.logger.log(`Scanned ${scanned.length} ${scanner.language} files`);
      files.push(...scanned);
    }
    return files;
  }

  private async insertCodeNamespaces(
    keptFiles: KeptFile[],
    boundedContexts: BoundedContext[],
    allContainerPaths: string[]
  ): Promise<void> {
    const bcNames = new Set(boundedContexts.map((bc) => bc.name));
    const namespacesPerContainer = groupRawNamespacesByContainer(keptFiles, allContainerPaths);

    const inserted = new Set<string>();
    for (const file of keptFiles) {
      if (inserted.has(file.rawNamespace)) continue;
      inserted.add(file.rawNamespace);
      await this.repository.insertCodeNamespace(toCodeNamespace(file.rawNamespace, file.language));
    }

    for (const [containerPath, rawNamespaces] of namespacesPerContainer) {
      for (const rawNs of rawNamespaces) {
        if (bcNames.has(containerPath)) {
          await this.repository.linkBoundedContextToCodeNamespace(containerPath, rawNs);
        } else {
          await this.repository.linkModuleToCodeNamespace(containerPath, rawNs);
        }
      }
    }
  }

  private async insertBuildingBlocks(
    keptFiles: KeptFile[],
    allContainerPaths: string[]
  ): Promise<void> {
    let blockCount = 0;
    let behaviorCount = 0;
    for (const file of keptFiles) {
      const containerPath = findContainer(file.namespace, allContainerPaths);
      for (const type of file.types) {
        const codeType: CodeType = {
          id: `${file.relativePath}:${type.typeName}`,
          name: type.typeName,
          fullName: `${file.rawNamespace}.${type.typeName}`,
          filePath: file.relativePath,
          language: file.language,
        };
        await this.repository.insertCodeType(codeType, file.rawNamespace);

        const block = toBuildingBlock(file, type);
        await this.repository.insertBuildingBlock(block, containerPath, codeType.id);
        blockCount++;

        for (const behavior of toBehaviors(block.id, type)) {
          await this.repository.insertBehavior(behavior, block.id);
          behaviorCount++;
        }
      }
    }
    this.logger.log(`Inserted ${blockCount} building blocks and ${behaviorCount} behaviors`);
  }
}

export function assembleDomainTree(
  boundedContexts: BoundedContext[],
  modules: Module[],
  keptFiles: KeptFile[],
  allContainerPaths: string[]
): DomainModelTree {
  const sortedBCs = [...boundedContexts].sort((a, b) => a.name.localeCompare(b.name));
  const modulesByParent = new Map<string, Module[]>();
  const sortedModules = [...modules].sort((a, b) => a.name.localeCompare(b.name));
  for (const mod of sortedModules) {
    const parent = parentPathOf(mod);
    const list = modulesByParent.get(parent) ?? [];
    list.push(mod);
    modulesByParent.set(parent, list);
  }

  const bbByContainer = new Map<string, BuildingBlockBranch[]>();
  for (const file of keptFiles) {
    const containerPath = findContainer(file.namespace, allContainerPaths);
    if (containerPath === "") continue;
    for (const type of file.types) {
      const block = toBuildingBlock(file, type);
      const behaviors = toBehaviors(block.id, type).sort((a, b) => a.name.localeCompare(b.name));
      const list = bbByContainer.get(containerPath) ?? [];
      list.push({ ...block, behaviors });
      bbByContainer.set(containerPath, list);
    }
  }
  for (const list of bbByContainer.values()) {
    list.sort((a, b) => a.name.localeCompare(b.name));
  }

  function buildModuleSubtree(parentPath: string): ModuleBranch<BuildingBlockBranch>[] {
    const children = modulesByParent.get(parentPath) ?? [];
    return children.map((m) => ({
      name: m.name,
      fullPath: m.fullPath,
      modules: buildModuleSubtree(m.fullPath),
      buildingBlocks: bbByContainer.get(m.fullPath) ?? [],
    }));
  }

  const tree: BoundedContextBranch<BuildingBlockBranch>[] = sortedBCs.map((bc) => ({
    name: bc.name,
    modules: buildModuleSubtree(bc.name),
    buildingBlocks: bbByContainer.get(bc.name) ?? [],
  }));
  return { boundedContexts: tree };
}

export function findModuleByPath(tree: DomainModelTree, path: string): ModuleBranch | undefined {
  for (const bc of tree.boundedContexts) {
    const found = findModuleInBranches(bc.modules, path);
    if (found) return found;
  }
  return undefined;
}

function findModuleInBranches(modules: ModuleBranch[], path: string): ModuleBranch | undefined {
  for (const mod of modules) {
    if (mod.fullPath === path) return mod;
    const found = findModuleInBranches(mod.modules, path);
    if (found) return found;
  }
  return undefined;
}

function toBuildingBlock(file: KeptFile, type: ScannedFile["types"][number]): BuildingBlock {
  const blockName = type.nameOverride ?? type.typeName;
  return {
    id: `${file.relativePath}:${blockName}`,
    name: blockName,
    type: type.blockType,
  };
}

function toBehaviors(blockId: string, type: ScannedFile["types"][number]): Behavior[] {
  return type.behaviors.map((b) => ({
    id: `${blockId}:${b.methodName}`,
    name: b.nameOverride ?? b.methodName,
    actor: b.actor,
  }));
}

function groupRawNamespacesByContainer(
  files: KeptFile[],
  containerPaths: string[]
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

function toCodeNamespace(fullName: string, language: Language): CodeNamespace {
  const parts = fullName.split(".");
  return { name: parts[parts.length - 1], fullName, language };
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
