import type { BehaviorMatch, ScannedType } from "../language-scanner.js";

/*
 * Extraction from one Java source file, the C# scanner's approach with two
 * differences: comments, string literals and annotation arguments are blanked
 * out before anything is matched, so braces and parentheses inside them never
 * count, and an annotation must sit directly on the declaration (annotations
 * and modifiers only in between) rather than anywhere before it.
 *
 * Behaviors are the methods that are not private: in Java the default,
 * package-private visibility is how a domain package exposes logic to
 * itself. Nothing Lombok generates is in the source, so nothing it generates
 * is a behavior.
 */

/**
 * The stereotype annotations of the Noesis Java annotations module
 * (`vision.noesis.annotations`), by simple name, with the building block type
 * each one declares in the model's vocabulary.
 */
export const STEREOTYPE_ANNOTATIONS: Readonly<Record<string, string>> = {
  AggregateRoot: "Aggregate",
  Entity: "Entity",
  ValueObject: "ValueObject",
  Identifier: "Identifier",
  DomainService: "DomainService",
  ApplicationService: "ApplicationService",
  Repository: "Repository",
  Factory: "Factory",
  Port: "Port",
  Adapter: "Adapter",
  Command: "Command",
  Query: "Query",
  Event: "DomainEvent",
};

type TypeKind = "class" | "interface" | "enum" | "record";

const PACKAGE_PATTERN = /^[ \t]*package[ \t]+([\w.]+)[ \t]*;/m;

// An annotation's arguments are blanked out before matching, so only its name is left.
const ANNOTATION = String.raw`@[\w.]+`;
const MODIFIER = String.raw`(?:public|protected|private|abstract|final|static|sealed|non-sealed|strictfp)\b`;
// Annotations and modifiers, then the kind keyword and the name. The keyword must not
// follow `@` (an `@interface` declares an annotation type) or `.` (`Order.class`).
const TYPE_DECLARATION_PATTERN = new RegExp(
  String.raw`((?:(?:${ANNOTATION}|${MODIFIER})\s+)*)(?<![@.\w])(class|interface|enum|record)\s+(\w+)`,
  "g"
);
const ANNOTATION_PATTERN = new RegExp(ANNOTATION, "g");
const ANNOTATION_NAME_PATTERN = /@([\w.]+)/g;
const ANNOTATION_HEAD_PATTERN = /@[\w.]+\s*/y;

const DISQUALIFYING_METHOD_KEYWORDS = /\b(class|interface|enum|record|new|return|throw)\b/;
const MODIFIER_WORD_PATTERN =
  /\b(?:public|protected|private|abstract|final|static|default|synchronized|native|strictfp|sealed|non-sealed)\b/g;
const TECHNICAL_METHOD_NAMES = new Set(["equals", "hashCode", "toString"]);

export function extractPackage(content: string): string | null {
  return PACKAGE_PATTERN.exec(blankOut(content))?.[1] ?? null;
}

/** Every type in the file that carries a stereotype annotation, with its non-private methods. */
export function parseStereotypedTypes(content: string): ScannedType[] {
  const text = blankAnnotationArguments(blankOut(content));
  const types: ScannedType[] = [];
  for (const match of text.matchAll(TYPE_DECLARATION_PATTERN)) {
    const [, prefix = "", kind = "", typeName = ""] = match;
    const blockType = stereotypeOf(annotationNames(prefix));
    if (blockType === null) continue;
    const declarationEnd = match.index + match[0].length;
    types.push({
      typeName,
      blockType,
      nameOverride: null,
      behaviors: extractBehaviors(text, declarationEnd, typeName, kind as TypeKind),
    });
  }
  return types;
}

/** The block type the annotations declare, or null when none is a stereotype. */
export function stereotypeOf(annotations: string[]): string | null {
  for (const annotation of annotations) {
    const blockType = STEREOTYPE_ANNOTATIONS[annotation];
    if (blockType !== undefined) return blockType;
  }
  return null;
}

/** Comments and string/char literals replaced by spaces, newlines kept, so nothing inside them is matched. */
export function blankOut(content: string): string {
  let out = "";
  let i = 0;
  const blank = (end: number) => {
    for (let j = i; j < end; j++) out += content[j] === "\n" ? "\n" : " ";
    i = end;
  };
  while (i < content.length) {
    const two = content.slice(i, i + 2);
    if (two === "//") {
      const end = content.indexOf("\n", i);
      blank(end === -1 ? content.length : end);
    } else if (two === "/*") {
      const end = content.indexOf("*/", i + 2);
      blank(end === -1 ? content.length : end + 2);
    } else if (content.startsWith('"""', i)) {
      const end = content.indexOf('"""', i + 3);
      blank(end === -1 ? content.length : end + 3);
    } else if (content[i] === '"' || content[i] === "'") {
      blank(literalEnd(content, i));
    } else {
      out += content[i];
      i++;
    }
  }
  return out;
}

/**
 * The parenthesised arguments of every annotation replaced by spaces, so an
 * annotation is its name alone however deeply its arguments nest. Runs on
 * blanked-out text, where no parenthesis hides in a string or a comment.
 */
export function blankAnnotationArguments(text: string): string {
  let out = "";
  let i = 0;
  while (i < text.length) {
    ANNOTATION_HEAD_PATTERN.lastIndex = i;
    const head = text[i] === "@" ? ANNOTATION_HEAD_PATTERN.exec(text) : null;
    if (head === null || text[i + head[0].length] !== "(") {
      out += text[i];
      i++;
      continue;
    }
    const argumentsStart = i + head[0].length;
    const argumentsEnd = matchingParenthesis(text, argumentsStart);
    out += head[0];
    for (let j = argumentsStart; j < argumentsEnd; j++) out += text[j] === "\n" ? "\n" : " ";
    i = argumentsEnd;
  }
  return out;
}

function annotationNames(prefix: string): string[] {
  return [...prefix.matchAll(ANNOTATION_NAME_PATTERN)].map((match) => {
    const qualified = match[1] ?? "";
    return qualified.slice(qualified.lastIndexOf(".") + 1);
  });
}

function extractBehaviors(
  text: string,
  searchStart: number,
  typeName: string,
  kind: TypeKind
): BehaviorMatch[] {
  if (kind === "enum") return [];
  const bodyStart = findTypeBodyStart(text, searchStart);
  if (bodyStart === -1) return [];
  const bodyEnd = findMatchingBrace(text, bodyStart);
  if (bodyEnd === -1) return [];
  return parsePublicMethods(text.substring(bodyStart + 1, bodyEnd), typeName, kind);
}

/** The `{` opening the body: the first brace outside parentheses, which a record header has. */
function findTypeBodyStart(text: string, from: number): number {
  let parens = 0;
  for (let i = from; i < text.length; i++) {
    const ch = text[i];
    if (ch === "(") parens++;
    else if (ch === ")") parens--;
    else if (ch === "{" && parens === 0) return i;
    else if (ch === ";" && parens === 0) return -1;
  }
  return -1;
}

function findMatchingBrace(text: string, start: number): number {
  let depth = 0;
  for (let i = start; i < text.length; i++) {
    if (text[i] === "{") depth++;
    else if (text[i] === "}" && --depth === 0) return i;
  }
  return -1;
}

function parsePublicMethods(body: string, typeName: string, kind: TypeKind): BehaviorMatch[] {
  const statements = flattenBraceBlocks(body).split(";");
  const seen = new Set<string>();
  const methods: BehaviorMatch[] = [];
  for (const statement of statements) {
    const method = parseMethodStatement(statement, typeName, kind);
    if (method === null || seen.has(method.methodName)) continue;
    seen.add(method.methodName);
    methods.push(method);
  }
  return methods;
}

/** Nested blocks (method bodies, nested types, initialisers) collapsed to a statement end. */
function flattenBraceBlocks(content: string): string {
  let result = "";
  let depth = 0;
  for (const ch of content) {
    if (ch === "{") {
      if (depth === 0) result += ";";
      depth++;
    } else if (ch === "}") {
      if (depth > 0) depth--;
    } else if (depth === 0) {
      result += ch;
    }
  }
  return result;
}

/**
 * Reads one statement as a method header. Any method that is not private is
 * a behavior — package-private included.
 * Constructors, the Object trio and anything with an initialiser (a field)
 * or a declaration keyword in its header are not methods; the parameter list
 * is not read, so a parameter may be named `record`.
 */
function parseMethodStatement(
  statement: string,
  typeName: string,
  kind: TypeKind
): BehaviorMatch | null {
  const withoutAnnotations = statement.replace(ANNOTATION_PATTERN, " ");
  const parenIdx = withoutAnnotations.indexOf("(");
  if (parenIdx === -1) return null;
  const header = withoutAnnotations.substring(0, parenIdx);
  if (DISQUALIFYING_METHOD_KEYWORDS.test(header)) return null;
  if (header.includes("=")) return null;

  const modifiers: string[] = header.match(MODIFIER_WORD_PATTERN) ?? [];
  if (modifiers.includes("private")) return null;

  const methodName = trailingWord(header.trimEnd());
  if (methodName === "") return null;
  if (methodName === typeName || TECHNICAL_METHOD_NAMES.has(methodName)) return null;
  // Only a name and no return type: not a method header.
  if (header.replace(MODIFIER_WORD_PATTERN, "").trim() === methodName) return null;

  return { methodName, nameOverride: null, actor: null };
}

/** The index just past the `)` closing the parenthesis opened at `open`. */
function matchingParenthesis(text: string, open: number): number {
  let depth = 0;
  for (let i = open; i < text.length; i++) {
    if (text[i] === "(") depth++;
    else if (text[i] === ")" && --depth === 0) return i + 1;
  }
  return text.length;
}

function trailingWord(text: string): string {
  let start = text.length;
  while (start > 0 && /\w/.test(text[start - 1] ?? "")) start--;
  return text.slice(start);
}

function literalEnd(content: string, open: number): number {
  const quote = content[open];
  for (let i = open + 1; i < content.length; i++) {
    if (content[i] === "\\") i++;
    else if (content[i] === quote || content[i] === "\n") return i + 1;
  }
  return content.length;
}
