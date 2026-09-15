/**
 * `noesis-config.json` in the project root. Namespaces are C# namespaces and
 * Java packages alike; both settings apply to every language.
 */
export interface NoesisConfig {
  /** Dotted segment sequences removed from every namespace before the hierarchy is read off it, e.g. "Company.Product" or "Domain". */
  namespacePartsToSkip: string[];
  /** Dotted patterns, `*` matching any run of segments, whose namespaces are left out of the model, e.g. "*.Tests". */
  namespacesToExclude: string[];
}
