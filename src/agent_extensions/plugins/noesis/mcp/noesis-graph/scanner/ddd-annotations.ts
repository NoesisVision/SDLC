export const DDD_ANNOTATIONS = [
  "DddAggregate",
  "DddApplicationService",
  "DddBoundedContext",
  "DddDomainEvent",
  "DddDomainService",
  "DddEntity",
  "DddFactory",
  "DddRepository",
  "DddValueObject",
] as const;

export type DddAnnotation = (typeof DDD_ANNOTATIONS)[number];

export function annotationToBlockType(annotation: DddAnnotation): string {
  return annotation.replace(/^Ddd/, "");
}
