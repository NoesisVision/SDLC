export interface BehaviorMeta {
  id: string;
  name: string;
  blockId: string;
  blockName: string;
  blockType: string;
}

export interface InvocationGraphData {
  focus: BehaviorMeta;
  callers: BehaviorMeta[];
  callees: BehaviorMeta[];
}
