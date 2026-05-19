export interface Invocation {
  source: string;
  destination: string;
}

export interface MethodDescriptor {
  filePath: string;
  typeName: string;
  methodName: string;
}

export interface BehaviorRow {
  id: string;
  filePath: string;
  typeName: string;
  methodName: string;
}
