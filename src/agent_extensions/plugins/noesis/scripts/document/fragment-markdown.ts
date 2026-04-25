import type {
  DocumentFragment,
  DocumentFragmentKind,
  SectionNode,
} from "../../shared-contracts/documents.js";

const HEADING_PATTERN = /^(#{1,6})\s+(.+?)\s*$/;
const FENCE_PATTERN = /^([ \t]*)(```+|~~~+)(.*)$/;
const LIST_ITEM_PATTERN = /^[ \t]*(?:[-*+]|\d+[.)])\s+/;
const BLOCKQUOTE_PATTERN = /^[ \t]*>\s?/;
const TABLE_ROW_PATTERN = /^[ \t]*\|.*\|[ \t]*$/;
const HTML_COMMENT_LINE = /^\s*<!--.*-->\s*$/;

interface LineSpan {
  text: string;
  start: number;
  end: number;
}

interface ParseState {
  fragments: DocumentFragment[];
  sectionStack: SectionNode[];
  rootSections: SectionNode[];
  currentPath: string[];
}

export interface FragmentationResult {
  fragments: DocumentFragment[];
  section_tree: SectionNode[];
}

export function fragmentMarkdown(content: string): FragmentationResult {
  const lines = splitLinesWithOffsets(content);
  const state: ParseState = {
    fragments: [],
    sectionStack: [],
    rootSections: [],
    currentPath: [],
  };

  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    const consumed = processLine(line, lines, i, state);
    i += consumed;
  }

  return {
    fragments: state.fragments,
    section_tree: state.rootSections,
  };
}

// --- Private functions ---

function processLine(
  line: LineSpan,
  lines: LineSpan[],
  index: number,
  state: ParseState,
): number {
  if (isBlank(line.text)) return 1;
  if (HTML_COMMENT_LINE.test(line.text) && index === 0) return 1;

  const fenceMatch = FENCE_PATTERN.exec(line.text);
  if (fenceMatch !== null) {
    return consumeCodeBlock(lines, index, fenceMatch[2], state);
  }

  const headingMatch = HEADING_PATTERN.exec(line.text);
  if (headingMatch !== null) {
    consumeHeading(headingMatch, state);
    return 1;
  }

  if (LIST_ITEM_PATTERN.test(line.text)) {
    return consumeBlock(lines, index, state, "list", isListContinuation);
  }
  if (BLOCKQUOTE_PATTERN.test(line.text)) {
    return consumeBlock(lines, index, state, "blockquote", (l) =>
      BLOCKQUOTE_PATTERN.test(l.text),
    );
  }
  if (TABLE_ROW_PATTERN.test(line.text)) {
    return consumeBlock(lines, index, state, "table", (l) =>
      TABLE_ROW_PATTERN.test(l.text),
    );
  }
  return consumeBlock(lines, index, state, "paragraph", isParagraphContinuation);
}

function consumeCodeBlock(
  lines: LineSpan[],
  startIndex: number,
  marker: string,
  state: ParseState,
): number {
  const start = lines[startIndex].start;
  let end = lines[startIndex].end;
  let i = startIndex + 1;
  const closer = marker[0]; // ` or ~

  while (i < lines.length) {
    end = lines[i].end;
    const line = lines[i].text;
    const fenceMatch = FENCE_PATTERN.exec(line);
    if (fenceMatch !== null && fenceMatch[2][0] === closer && fenceMatch[2].length >= marker.length) {
      i++;
      break;
    }
    i++;
  }

  pushFragment(state, "code_block", start, end, sliceText(lines, startIndex, i));
  return i - startIndex;
}

function consumeBlock(
  lines: LineSpan[],
  startIndex: number,
  state: ParseState,
  kind: DocumentFragmentKind,
  isContinuation: (line: LineSpan, prev: LineSpan) => boolean,
): number {
  const start = lines[startIndex].start;
  let end = lines[startIndex].end;
  let i = startIndex + 1;

  while (i < lines.length) {
    const current = lines[i];
    if (isBlank(current.text)) break;
    if (HEADING_PATTERN.test(current.text)) break;
    if (FENCE_PATTERN.test(current.text)) break;
    if (!isContinuation(current, lines[i - 1])) break;
    end = current.end;
    i++;
  }

  pushFragment(state, kind, start, end, sliceText(lines, startIndex, i));
  return i - startIndex;
}

function consumeHeading(
  match: RegExpExecArray,
  state: ParseState,
): void {
  const level = match[1].length;
  const title = match[2].trim();

  while (
    state.sectionStack.length > 0 &&
    state.sectionStack[state.sectionStack.length - 1].level >= level
  ) {
    state.sectionStack.pop();
  }

  const parent =
    state.sectionStack.length > 0
      ? state.sectionStack[state.sectionStack.length - 1]
      : null;
  const path = parent !== null ? [...parent.path, title] : [title];

  const node: SectionNode = {
    level,
    title,
    path,
    fragment_indices: [],
    children: [],
  };

  if (parent === null) {
    state.rootSections.push(node);
  } else {
    parent.children.push(node);
  }
  state.sectionStack.push(node);
  state.currentPath = path;
}

function isBlank(text: string): boolean {
  return text.trim().length === 0;
}

function isListContinuation(current: LineSpan, _prev: LineSpan): boolean {
  if (LIST_ITEM_PATTERN.test(current.text)) return true;
  return /^[ \t]+\S/.test(current.text);
}

function isParagraphContinuation(current: LineSpan, _prev: LineSpan): boolean {
  if (LIST_ITEM_PATTERN.test(current.text)) return false;
  if (BLOCKQUOTE_PATTERN.test(current.text)) return false;
  if (TABLE_ROW_PATTERN.test(current.text)) return false;
  return true;
}

function pushFragment(
  state: ParseState,
  kind: DocumentFragmentKind,
  startOffset: number,
  endOffset: number,
  text: string,
): void {
  const trimmed = text.trim();
  if (trimmed.length === 0) return;
  const fragment: DocumentFragment = {
    index: state.fragments.length,
    start_offset: startOffset,
    end_offset: endOffset,
    section_path: [...state.currentPath],
    kind,
    text: trimmed,
    categories: [],
  };
  state.fragments.push(fragment);
  if (state.sectionStack.length > 0) {
    state.sectionStack[state.sectionStack.length - 1].fragment_indices.push(fragment.index);
  }
}

function sliceText(lines: LineSpan[], start: number, end: number): string {
  return lines
    .slice(start, end)
    .map((l) => l.text)
    .join("\n");
}

function splitLinesWithOffsets(content: string): LineSpan[] {
  const lines: LineSpan[] = [];
  let cursor = 0;
  while (cursor <= content.length) {
    const newlineIndex = content.indexOf("\n", cursor);
    if (newlineIndex === -1) {
      if (cursor < content.length) {
        lines.push({
          text: content.slice(cursor),
          start: cursor,
          end: content.length,
        });
      }
      break;
    }
    lines.push({
      text: content.slice(cursor, newlineIndex),
      start: cursor,
      end: newlineIndex,
    });
    cursor = newlineIndex + 1;
  }
  return lines;
}
