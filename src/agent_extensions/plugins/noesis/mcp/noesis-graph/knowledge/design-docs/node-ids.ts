export function actorNodeId(designDocId: string, actorName: string): string {
  return `${designDocId}|A:${actorName}`;
}

export function boundedContextNodeId(
  designDocId: string,
  bcName: string,
): string {
  return `${designDocId}|BC:${bcName}`;
}

export function moduleNodeId(bcId: string, modulePath: string): string {
  return `${bcId}|M:${modulePath}`;
}

export function buildingBlockNodeId(
  containerId: string,
  bbName: string,
): string {
  return `${containerId}|BB:${bbName}`;
}

export function behaviourNodeId(bbId: string, behaviourName: string): string {
  return `${bbId}|BH:${behaviourName}`;
}

export function ruleNodeId(parentId: string, ruleName: string): string {
  return `${parentId}|R:${ruleName}`;
}

export function scenarioNodeId(parentId: string, scenarioName: string): string {
  return `${parentId}|S:${scenarioName}`;
}

export function qualityAttributeNodeId(
  designDocId: string,
  qaName: string,
): string {
  return `${designDocId}|QA:${qaName}`;
}
