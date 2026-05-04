export type ChangeStatus = "added" | "modified" | "removed";

export interface DesignDocListItem {
  id: string;
  date: string;
  title: string;
  description: string;
  edited_by_user?: boolean;
  implemented: boolean;
}

export interface DesignDocsPageData {
  docs: DesignDocListItem[];
}

export interface DesignDocChangeSet<T> {
  added: T[];
  removed: string[];
  modified: T[];
}

export interface DesignedPropertyData {
  name: string;
  type: string | null;
  description?: string | null;
  nullable?: boolean;
  collection?: boolean;
}

export interface DesignedRuleData {
  name: string;
  ruleType: string | null;
  description: string | null;
}

export interface DesignedScenarioData {
  name: string;
  description: string;
  given: string;
  when: string;
  then: string;
}

export interface DesignedBehaviourData {
  name: string;
  description: string | null;
  type: string | null;
  isPublic: boolean;
  actor: string | null;
  input?: DesignDocChangeSet<string>;
  output?: DesignDocChangeSet<string>;
  usedBuildingBlocks?: DesignDocChangeSet<string>;
  rules?: DesignDocChangeSet<DesignedRuleData>;
  scenarios?: DesignDocChangeSet<DesignedScenarioData>;
}

export interface DesignedBuildingBlockData {
  name: string;
  type: string | null;
  description: string | null;
  implements?: string[];
  properties?: DesignDocChangeSet<DesignedPropertyData>;
  behaviours?: DesignDocChangeSet<DesignedBehaviourData>;
  rules?: DesignDocChangeSet<DesignedRuleData>;
  scenarios?: DesignDocChangeSet<DesignedScenarioData>;
}

export interface DesignedDomainModuleData {
  name: string;
  description: string | null;
  buildingBlocks?: DesignDocChangeSet<DesignedBuildingBlockData>;
}

export interface DesignedBoundedContextData {
  name: string;
  description: string | null;
  modules?: DesignDocChangeSet<DesignedDomainModuleData>;
  buildingBlocks?: DesignDocChangeSet<DesignedBuildingBlockData>;
}

export interface DesignedActorData {
  name: string;
  description: string | null;
}

export interface DesignedQualityAttributeData {
  name: string;
  type: string | null;
  description: string | null;
}

export interface DesignDocSourceData {
  id: string;
  name: string;
  description: string;
  actors?: DesignDocChangeSet<DesignedActorData>;
  boundedContexts?: DesignDocChangeSet<DesignedBoundedContextData>;
  qualityAttributes?: DesignDocChangeSet<DesignedQualityAttributeData>;
}

export interface DesignDocDetailData {
  id: string;
  name: string;
  description: string;
  date: string;
  implemented: boolean;
  source: DesignDocSourceData;
}
