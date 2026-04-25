import { Injectable } from "@nestjs/common";
import { ScannerService } from "../../scanner/scanner.service.js";
import { InvocationsService } from "../../scanner/invocations/invocations.service.js";
import type {
  Behavior,
  BuildingBlockBranch,
  DomainModelTree,
  ModuleBranch,
} from "../../scanner/domain-model/domain-model.js";
import type {
  BehaviorMeta,
  InvocationGraphData,
} from "./invocation-graph-data.js";

@Injectable()
export class InvocationGraphService {
  constructor(
    private readonly scanner: ScannerService,
    private readonly invocations: InvocationsService,
  ) {}

  async getInvocationGraph(behaviorId: string): Promise<InvocationGraphData> {
    const tree = await this.scanner.getDomainModel();
    const index = buildBehaviorIndex(tree);

    const focus = index.get(behaviorId);
    if (focus === undefined) {
      throw new Error(`Behavior not found: ${behaviorId}`);
    }

    const incoming = await this.invocations.getBehaviorInvocations({
      destinationBehaviorId: behaviorId,
    });
    const outgoing = await this.invocations.getBehaviorInvocations({
      sourceBehaviorId: behaviorId,
    });

    return {
      focus,
      callers: resolveMany(incoming.map((i) => i.source), index),
      callees: resolveMany(outgoing.map((i) => i.destination), index),
    };
  }
}

function buildBehaviorIndex(
  tree: DomainModelTree<BuildingBlockBranch>,
): Map<string, BehaviorMeta> {
  const index = new Map<string, BehaviorMeta>();

  const visitBlocks = (blocks: BuildingBlockBranch[]) => {
    for (const block of blocks) {
      for (const behavior of block.behaviors) {
        index.set(behavior.id, toMeta(behavior, block));
      }
    }
  };

  const visitModules = (modules: ModuleBranch<BuildingBlockBranch>[]) => {
    for (const mod of modules) {
      visitBlocks(mod.buildingBlocks);
      visitModules(mod.modules);
    }
  };

  for (const bc of tree.boundedContexts) {
    visitBlocks(bc.buildingBlocks);
    visitModules(bc.modules);
  }

  return index;
}

function resolveMany(
  ids: string[],
  index: Map<string, BehaviorMeta>,
): BehaviorMeta[] {
  const seen = new Set<string>();
  const result: BehaviorMeta[] = [];
  for (const id of ids) {
    if (seen.has(id)) continue;
    seen.add(id);
    const meta = index.get(id);
    if (meta !== undefined) result.push(meta);
  }
  return result;
}

function toMeta(behavior: Behavior, block: BuildingBlockBranch): BehaviorMeta {
  return {
    id: behavior.id,
    name: behavior.name,
    blockId: block.id,
    blockName: block.name,
    blockType: block.type,
  };
}
