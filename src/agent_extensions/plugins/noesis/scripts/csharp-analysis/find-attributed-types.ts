import { readJson, outputResult, parseArgs, exitError } from "../io.js";
import { SerenaClient } from "./serena-client.js";
import { parseMethodSignature, parsePropertySignature, parseFieldSignature } from "./signature-parser.js";
import {
  InputConfigSchema,
  LSP_KIND,
  TYPE_KINDS,
  lspKindToTypeKind,
  type AnalysisResult,
  type InputConfig,
  type SerenaSymbol,
  type TypeInfo,
} from "./types.js";

const CONCURRENCY_LIMIT = 10;

export async function findAttributedTypes(config: InputConfig): Promise<AnalysisResult> {
  const client = new SerenaClient();
  try {
    await client.connect(config.serena);
    return await analyzeAttributes(client, config.attributes);
  } finally {
    await client.disconnect();
  }
}

async function analyzeAttributes(
  client: SerenaClient,
  attributeNames: string[],
): Promise<AnalysisResult> {
  const errors: AnalysisResult["errors"] = [];
  const typeMap = new Map<string, TypeInfo>();

  for (const attrName of attributeNames) {
    const candidates = await resolveAttributeSymbol(client, attrName);
    if (candidates.length === 0) {
      errors.push({ attribute: attrName, message: "Attribute symbol not found" });
      continue;
    }

    const referencingTypes = await findDecoratedTypes(client, candidates);
    const deduplicated = deduplicateTypes(referencingTypes);

    const typeInfoBatches = await processInBatches(
      deduplicated,
      CONCURRENCY_LIMIT,
      (ref) => extractTypeInfo(client, ref, attrName),
    );

    for (const typeInfo of typeInfoBatches) {
      if (typeInfo === null) continue;
      const key = `${typeInfo.filePath}:${typeInfo.name}`;
      const existing = typeMap.get(key);
      if (existing !== undefined) {
        mergeAttributes(existing, typeInfo.attributes);
      } else {
        typeMap.set(key, typeInfo);
      }
    }
  }

  return { types: [...typeMap.values()], errors };
}

async function resolveAttributeSymbol(
  client: SerenaClient,
  attrName: string,
): Promise<SerenaSymbol[]> {
  const withSuffix = attrName.endsWith("Attribute") ? attrName : `${attrName}Attribute`;
  const withoutSuffix = attrName.endsWith("Attribute")
    ? attrName.slice(0, -"Attribute".length)
    : attrName;

  const [resultWithSuffix, resultWithout] = await Promise.all([
    client.findSymbol({
      namePathPattern: withSuffix,
      includeKinds: [LSP_KIND.CLASS],
    }),
    withSuffix !== withoutSuffix
      ? client.findSymbol({
          namePathPattern: withoutSuffix,
          includeKinds: [LSP_KIND.CLASS],
        })
      : Promise.resolve([]),
  ]);

  return [...resultWithSuffix, ...resultWithout];
}

async function findDecoratedTypes(
  client: SerenaClient,
  attributeSymbols: SerenaSymbol[],
): Promise<SerenaSymbol[]> {
  const results: SerenaSymbol[] = [];
  for (const attr of attributeSymbols) {
    const refs = await client.findReferencingSymbols({
      namePath: attr.name_path,
      relativePath: attr.relative_path,
      includeKinds: [...TYPE_KINDS],
    });
    for (const ref of refs) {
      results.push(ref.referencing_symbol);
    }
  }
  return results;
}

function deduplicateTypes(symbols: SerenaSymbol[]): SerenaSymbol[] {
  const seen = new Map<string, SerenaSymbol>();
  for (const sym of symbols) {
    const key = `${sym.relative_path}:${sym.name_path}`;
    if (!seen.has(key)) {
      seen.set(key, sym);
    }
  }
  return [...seen.values()];
}

async function extractTypeInfo(
  client: SerenaClient,
  typeSym: SerenaSymbol,
  attributeName: string,
): Promise<TypeInfo | null> {
  const kind = lspKindToTypeKind(typeSym.kind);
  if (kind === null) return null;

  const [symbolDetails, overview] = await Promise.all([
    client.findSymbol({
      namePathPattern: typeSym.name_path,
      relativePath: typeSym.relative_path,
      depth: 1,
      includeInfo: true,
      maxMatches: 1,
    }),
    client.getSymbolsOverview({
      relativePath: typeSym.relative_path,
      depth: 0,
    }),
  ]);

  if (symbolDetails.length === 0) return null;

  const symbol = symbolDetails[0];
  const namespace = extractNamespace(overview);
  const fullyQualifiedName = namespace !== ""
    ? `${namespace}.${symbol.name}`
    : symbol.name;

  const methods = extractMethods(symbol.children ?? []);
  const properties = extractProperties(symbol.children ?? []);
  const fields = extractFields(symbol.children ?? []);

  return {
    name: symbol.name,
    fullyQualifiedName,
    namespace,
    kind,
    filePath: typeSym.relative_path,
    attributes: [attributeName],
    methods,
    properties,
    fields,
  };
}

function extractNamespace(overview: Array<{ name: string; kind: number }>): string {
  const ns = overview.find((sym) => sym.kind === LSP_KIND.NAMESPACE);
  return ns?.name ?? "";
}

function extractMethods(children: SerenaSymbol[]): TypeInfo["methods"] {
  const methods: TypeInfo["methods"] = [];
  for (const child of children) {
    if (child.kind !== LSP_KIND.METHOD) continue;
    if (child.info === undefined) continue;
    const parsed = parseMethodSignature(child.info);
    if (parsed !== null) {
      methods.push(parsed);
    }
  }
  return methods;
}

function extractProperties(children: SerenaSymbol[]): TypeInfo["properties"] {
  const properties: TypeInfo["properties"] = [];
  for (const child of children) {
    if (child.kind !== LSP_KIND.PROPERTY) continue;
    if (child.info === undefined) continue;
    const parsed = parsePropertySignature(child.info);
    if (parsed !== null) {
      properties.push(parsed);
    }
  }
  return properties;
}

function extractFields(children: SerenaSymbol[]): TypeInfo["fields"] {
  const fields: TypeInfo["fields"] = [];
  for (const child of children) {
    if (child.kind !== LSP_KIND.FIELD) continue;
    if (child.info === undefined) continue;
    const parsed = parseFieldSignature(child.info);
    if (parsed !== null) {
      fields.push(parsed);
    }
  }
  return fields;
}

function mergeAttributes(existing: TypeInfo, newAttributes: string[]): void {
  for (const attr of newAttributes) {
    if (!existing.attributes.includes(attr)) {
      existing.attributes.push(attr);
    }
  }
}

async function processInBatches<T, R>(
  items: T[],
  batchSize: number,
  fn: (item: T) => Promise<R>,
): Promise<R[]> {
  const results: R[] = [];
  for (let i = 0; i < items.length; i += batchSize) {
    const batch = items.slice(i, i + batchSize);
    const batchResults = await Promise.all(batch.map(fn));
    results.push(...batchResults);
  }
  return results;
}

// --- Entry point ---

async function main(): Promise<void> {
  const args = parseArgs(["config"]);
  const config = await readJson(InputConfigSchema, args.config);
  const result = await findAttributedTypes(config);
  outputResult(result);
}

if (import.meta.main) {
  main().catch((err: unknown) => {
    exitError(err instanceof Error ? err.message : String(err));
  });
}
