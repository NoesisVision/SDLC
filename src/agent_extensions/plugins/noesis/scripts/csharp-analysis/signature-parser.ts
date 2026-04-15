import type { MethodInfo, ParameterInfo, PropertyInfo, FieldInfo } from "./types.js";

const ACCESS_MODIFIERS = ["public", "protected", "internal", "private", "protected internal", "private protected"];
const NON_TYPE_MODIFIERS = ["static", "virtual", "override", "abstract", "sealed", "async", "new", "extern", "readonly", "volatile", "const", "unsafe"];

export function parseMethodSignature(info: string): MethodInfo | null {
  const cleaned = normalizeSignature(info);
  if (!isPublic(cleaned)) return null;

  const withoutModifiers = stripModifiers(cleaned);
  const paramsStart = findParamsStart(withoutModifiers);
  if (paramsStart === -1) return null;

  const beforeParams = withoutModifiers.substring(0, paramsStart).trim();
  const paramsContent = extractBetween(withoutModifiers, paramsStart, "(", ")");
  if (paramsContent === null) return null;

  const { type: returnType, name } = splitTypeAndName(beforeParams);
  if (returnType === "" || name === "") return null;

  const parameters = parseParameterList(paramsContent);

  return { name, returnType, parameters };
}

export function parsePropertySignature(info: string): PropertyInfo | null {
  const cleaned = normalizeSignature(info);
  if (!isPublic(cleaned)) return null;

  const withoutModifiers = stripModifiers(cleaned);
  const braceIdx = withoutModifiers.indexOf("{");
  const beforeBrace = braceIdx !== -1
    ? withoutModifiers.substring(0, braceIdx).trim()
    : withoutModifiers.trim();

  const { type, name } = splitTypeAndName(beforeBrace);
  if (type === "" || name === "") return null;

  return { name, type };
}

export function parseFieldSignature(info: string): FieldInfo | null {
  const cleaned = normalizeSignature(info);
  if (!isPublic(cleaned)) return null;

  const withoutModifiers = stripModifiers(cleaned);
  const semicolonIdx = withoutModifiers.indexOf(";");
  const content = semicolonIdx !== -1
    ? withoutModifiers.substring(0, semicolonIdx).trim()
    : withoutModifiers.trim();

  const equalsIdx = findOutsideBrackets(content, "=");
  const beforeEquals = equalsIdx !== -1
    ? content.substring(0, equalsIdx).trim()
    : content;

  const { type, name } = splitTypeAndName(beforeEquals);
  if (type === "" || name === "") return null;

  return { name, type };
}

export function isPublic(signature: string): boolean {
  const tokens = signature.trimStart().split(/\s+/);
  return tokens[0] === "public";
}

// --- Private helpers ---

function normalizeSignature(info: string): string {
  const lines = info.split("\n");
  const signatureLine = lines.find((line) => {
    const trimmed = line.trim();
    return ACCESS_MODIFIERS.some((mod) => trimmed.startsWith(mod));
  }) ?? lines[0] ?? "";
  return signatureLine.trim().replace(/\s+/g, " ");
}

function stripModifiers(sig: string): string {
  const tokens = sig.split(/\s+/);
  let i = 0;
  const allModifiers = [...ACCESS_MODIFIERS.flatMap((m) => m.split(" ")), ...NON_TYPE_MODIFIERS];
  while (i < tokens.length && allModifiers.includes(tokens[i])) {
    i++;
  }
  return tokens.slice(i).join(" ");
}

function splitTypeAndName(text: string): { type: string; name: string } {
  const trimmed = text.trim();
  if (trimmed === "") return { type: "", name: "" };

  const lastSpace = findLastSpaceOutsideBrackets(trimmed);
  if (lastSpace === -1) return { type: "", name: trimmed };

  return {
    type: trimmed.substring(0, lastSpace).trim(),
    name: trimmed.substring(lastSpace + 1).trim(),
  };
}

function findLastSpaceOutsideBrackets(text: string): number {
  let depth = 0;
  let lastSpace = -1;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (ch === "<" || ch === "(") depth++;
    else if (ch === ">" || ch === ")") depth--;
    else if (ch === " " && depth === 0) lastSpace = i;
  }
  return lastSpace;
}

function findParamsStart(text: string): number {
  let depth = 0;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (ch === "<") depth++;
    else if (ch === ">") depth--;
    else if (ch === "(" && depth === 0) return i;
  }
  return -1;
}

function extractBetween(text: string, startIdx: number, open: string, close: string): string | null {
  if (text[startIdx] !== open) return null;
  let depth = 1;
  let i = startIdx + 1;
  while (i < text.length && depth > 0) {
    if (text[i] === open) depth++;
    else if (text[i] === close) depth--;
    i++;
  }
  if (depth !== 0) return null;
  return text.substring(startIdx + 1, i - 1);
}

function findOutsideBrackets(text: string, target: string): number {
  let depth = 0;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (ch === "<" || ch === "(") depth++;
    else if (ch === ">" || ch === ")") depth--;
    else if (ch === target && depth === 0) return i;
  }
  return -1;
}

function parseParameterList(content: string): ParameterInfo[] {
  const trimmed = content.trim();
  if (trimmed === "") return [];

  const params: ParameterInfo[] = [];
  const parts = splitTopLevel(trimmed, ",");

  for (const part of parts) {
    const param = parseSingleParameter(part.trim());
    if (param !== null) {
      params.push(param);
    }
  }

  return params;
}

function parseSingleParameter(text: string): ParameterInfo | null {
  const trimmed = text.trim();
  if (trimmed === "") return null;

  const equalsIdx = findOutsideBrackets(trimmed, "=");
  const beforeDefault = equalsIdx !== -1
    ? trimmed.substring(0, equalsIdx).trim()
    : trimmed;

  const withoutParamModifiers = stripParamModifiers(beforeDefault);
  const { type, name } = splitTypeAndName(withoutParamModifiers);
  if (type === "" || name === "") return null;

  return { name, type };
}

function stripParamModifiers(text: string): string {
  const paramModifiers = ["ref", "out", "in", "params", "this"];
  const tokens = text.split(/\s+/);
  let i = 0;
  while (i < tokens.length && paramModifiers.includes(tokens[i])) {
    i++;
  }
  return tokens.slice(i).join(" ");
}

function splitTopLevel(text: string, delimiter: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let start = 0;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (ch === "<" || ch === "(") depth++;
    else if (ch === ">" || ch === ")") depth--;
    else if (ch === delimiter && depth === 0) {
      parts.push(text.substring(start, i));
      start = i + 1;
    }
  }
  parts.push(text.substring(start));
  return parts;
}
