import type {
  BuildingBlockBranch,
  DomainModelTree,
} from "../../scanner/domain-model/domain-model.js";

export interface ModelExplorerData {
  tree: DomainModelTree<BuildingBlockBranch>;
}
