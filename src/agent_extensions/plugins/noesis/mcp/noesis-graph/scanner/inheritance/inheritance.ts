import type { InheritanceMap, TypeHeader } from "./inheritance.types.js";

export interface InheritanceSourceFile {
  relativePath: string;
  content: string;
}

const TYPE_DECLARATION_PATTERN =
  /\b(?:class|struct|interface|record)\s+(\w+)\s*(?:<[^>]*>)?\s*(?::\s*([^{]+))?\s*\{/g;

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
  const results: TypeHeader[] = [];
  TYPE_DECLARATION_PATTERN.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = TYPE_DECLARATION_PATTERN.exec(file.content)) !== null) {
    const typeName = match[1];
    const ancestorsFragment = match[2] ?? "";
    const { baseTypeNames, interfaceTypeNames } = splitAncestors(ancestorsFragment);
    results.push({
      typeId: `${file.relativePath}:${typeName}`,
      typeName,
      filePath: file.relativePath,
      baseTypeNames,
      interfaceTypeNames,
    });
  }
  return results;
}

function splitAncestors(fragment: string): {
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
  return {
    baseTypeNames: [names[0]],
    interfaceTypeNames: names.slice(1),
  };
}

function stripGenericArgs(name: string): string {
  const idx = name.indexOf("<");
  return idx === -1 ? name : name.substring(0, idx);
}
