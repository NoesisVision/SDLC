/**
 * TypeScript types generated from P3 Model Changes Schema
 * Source: tools/claude/skills/design-feature/model-changes-schema.json
 */

/**
 * Type of change being made to the P3 model
 */
export type ChangeType = 'element' | 'relation';

/**
 * Type of P3 domain element
 */
export type ElementType = 'DomainBehavior' | 'DomainObject' | 'DomainModule';

/**
 * Operation type for element changes
 */
export type ElementOperation = 'Create' | 'Update' | 'Delete';

/**
 * Operation type for relation changes (only Create and Delete allowed)
 */
export type RelationOperation = 'Create' | 'Delete';

/**
 * Type of P3 relation
 */
export type RelationType =
  | 'DomainBehavior.InvokesBehavior'
  | 'DomainBehavior.UsesObject'
  | 'DomainModule.ContainsDomainModule'
  | 'DomainModule.ContainsObject'
  | 'DomainModule.ContainsBehavior'
  | 'DomainObject.ContainsBehavior'
  | 'DomainObject.UsesObject';

/**
 * Business rule definition for DomainBehavior elements
 */
export interface BusinessRule {
  name: string;
  description: string;
}

/**
 * Base interface for element changes
 */
interface BaseElementChange {
  changeType: 'element';
  elementType: ElementType;
  operation: ElementOperation;
  tags?: string[];
  businessRules?: BusinessRule[];
  bddScenarios?: string[];
}

/**
 * Element creation change
 */
export interface CreateElementChange extends BaseElementChange {
  operation: 'Create';
  name: string;
  tags: string[];
  elementId?: never;
}

/**
 * Element update change
 */
export interface UpdateElementChange extends BaseElementChange {
  operation: 'Update';
  elementId: string;
  tags: string[];
  name?: string;
}

/**
 * Element deletion change
 */
export interface DeleteElementChange extends BaseElementChange {
  operation: 'Delete';
  elementId: string;
  name?: never;
  tags?: never;
  businessRules?: never;
  bddScenarios?: never;
}

/**
 * Union type for all element changes
 */
export type ElementChange = CreateElementChange | UpdateElementChange | DeleteElementChange;

/**
 * Relation change (create or delete relationships between elements)
 */
export interface RelationChange {
  changeType: 'relation';
  operation: RelationOperation;
  sourceId: string;
  destinationId: string;
  type: RelationType;
}

/**
 * Union type for all P3 model changes
 */
export type ModelChange = ElementChange | RelationChange;

/**
 * Root schema for P3 model changes
 */
export interface ModelChanges {
  changes: ModelChange[];
}

/**
 * Type guard to check if a change is an element change
 */
export function isElementChange(change: ModelChange): change is ElementChange {
  return change.changeType === 'element';
}

/**
 * Type guard to check if a change is a relation change
 */
export function isRelationChange(change: ModelChange): change is RelationChange {
  return change.changeType === 'relation';
}

/**
 * Type guard to check if an element change is a create operation
 */
export function isCreateOperation(change: ElementChange): change is CreateElementChange {
  return change.operation === 'Create';
}

/**
 * Type guard to check if an element change is an update operation
 */
export function isUpdateOperation(change: ElementChange): change is UpdateElementChange {
  return change.operation === 'Update';
}

/**
 * Type guard to check if an element change is a delete operation
 */
export function isDeleteOperation(change: ElementChange): change is DeleteElementChange {
  return change.operation === 'Delete';
}
