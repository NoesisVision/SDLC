export type TypeKind = "class" | "struct" | "record" | "interface";

export interface TypeHeader {
  typeId: string;
  typeName: string;
  filePath: string;
  kind: TypeKind;
  baseTypeNames: string[];
  interfaceTypeNames: string[];
}

export interface InheritanceMap {
  byTypeId: Map<string, TypeHeader>;
  byTypeName: Map<string, TypeHeader[]>;
}

export interface InheritanceSourceFile {
  relativePath: string;
  content: string;
}

const TYPE_DECLARATION_PATTERN =
  /\b(?:class|struct|interface|record)\s+(\w+)\s*(?:<[^>]*>)?\s*(?::\s*([^{]+))?\s*\{/g;

export function ancestorsOf(map: InheritanceMap, typeName: string): string[] {
  const result: string[] = [];
  const seen = new Set<string>();
  let current: string | undefined = typeName;

  while (current !== undefined && !seen.has(current)) {
    seen.add(current);
    const headers = map.byTypeName.get(current);
    if (!headers || headers.length === 0) break;
    const header = headers[0];
    if (header.kind === "interface") break;
    for (const intf of header.interfaceTypeNames) {
      if (!result.includes(intf)) result.push(intf);
    }
    if (header.baseTypeNames.length === 0) break;
    const next = header.baseTypeNames[0];
    if (!result.includes(next)) result.push(next);
    const nextHeaders = map.byTypeName.get(next);
    if (nextHeaders && nextHeaders[0].kind === "interface") break;
    current = next;
  }

  return result;
}

export function extractInheritanceMap(
  files: InheritanceSourceFile[],
): InheritanceMap {
  const byTypeId = new Map<string, TypeHeader>();
  const byTypeName = new Map<string, TypeHeader[]>();

  for (const file of files) {
    for (const header of extractTypeHeadersFromFile(file)) {
      byTypeId.set(header.typeId, header);
      const existing = byTypeName.get(header.typeName) ?? [];
      existing.push(header);
      byTypeName.set(header.typeName, existing);
    }
  }

  return { byTypeId, byTypeName };
}

function extractTypeHeadersFromFile(
  file: InheritanceSourceFile,
): TypeHeader[] {
  // First pass: collect all type kinds (interface, class, struct, record)
  const typeKinds = new Map<string, string>();
  TYPE_DECLARATION_PATTERN.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = TYPE_DECLARATION_PATTERN.exec(file.content)) !== null) {
    const kind = extractTypeKind(match);
    const typeName = match[1];
    typeKinds.set(typeName, kind);
  }

  // Second pass: extract headers with interface classification
  const results: TypeHeader[] = [];
  TYPE_DECLARATION_PATTERN.lastIndex = 0;
  while ((match = TYPE_DECLARATION_PATTERN.exec(file.content)) !== null) {
    const typeName = match[1];
    const ancestorsFragment = match[2] ?? "";
    const { baseTypeNames, interfaceTypeNames } = splitAncestors(
      ancestorsFragment,
      typeKinds,
    );
    results.push({
      typeId: `${file.relativePath}:${typeName}`,
      typeName,
      filePath: file.relativePath,
      kind: typeKinds.get(typeName) as TypeKind ?? "class",
      baseTypeNames,
      interfaceTypeNames,
    });
  }
  return results;
}

function extractTypeKind(match: RegExpExecArray): string {
  const fullMatch = match[0];
  if (fullMatch.includes("interface")) return "interface";
  if (fullMatch.includes("struct")) return "struct";
  if (fullMatch.includes("record")) return "record";
  return "class";
}

function splitAncestors(
  fragment: string,
  typeKinds: Map<string, string>,
): {
  baseTypeNames: string[];
  interfaceTypeNames: string[];
} {
  const trimmed = fragment.trim();
  if (trimmed === "") return { baseTypeNames: [], interfaceTypeNames: [] };

  const names = trimmed
    .split(",")
    .map((part) => stripGenericArgs(part.trim()))
    .filter((n) => n !== "");

  if (names.length === 0) return { baseTypeNames: [], interfaceTypeNames: [] };

  const baseTypeNames: string[] = [];
  const interfaceTypeNames: string[] = [];

  for (let i = 0; i < names.length; i++) {
    const name = names[i];
    const kind = typeKinds.get(name);

    // If the type is declared in this file as an interface, treat it as interface
    if (kind === "interface") {
      interfaceTypeNames.push(name);
    }
    // For external types, use position: first is base, rest are interfaces
    else if (i === 0) {
      baseTypeNames.push(name);
    } else {
      interfaceTypeNames.push(name);
    }
  }

  return { baseTypeNames, interfaceTypeNames };
}

function stripGenericArgs(name: string): string {
  const idx = name.indexOf("<");
  return idx === -1 ? name : name.substring(0, idx);
}
