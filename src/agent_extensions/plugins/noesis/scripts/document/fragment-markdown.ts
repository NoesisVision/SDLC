import type {
  DocumentFragment,
  DocumentFragmentKind,
  SectionNode,
} from "../../shared-contracts/document.js";

const HEADING_PATTERN = /^(#{1,6})\s+(.+?)\s*$/;
const FENCE_PATTERN = /^([ \t]*)(```+|~~~+)(.*)$/;
const LIST_ITEM_PATTERN = /^[ \t]*(?:[-*+]|\d+[.)])\s+/;
const TOP_LEVEL_LIST_ITEM_PATTERN = /^(?:[-*+]|\d+[.)])\s+/;
const BLOCKQUOTE_PATTERN = /^[ \t]*>\s?/;
const TABLE_ROW_PATTERN = /^[ \t]*\|.*\|[ \t]*$/;
const HTML_COMMENT_LINE = /^\s*<!--.*-->\s*$/;
const STRUCTURAL_PARAGRAPH_PATTERN =
  /^(?:\*\*[^*]+\*\*:?|\*[^*]+\*|\*\*Aktorzy:?\*\*[^\n]*|\*\*Cel:?\*\*[^\n]*|\*\*Powiązane scenariusze:?\*\*[^\n]*|\*\*Moduły:?\*\*[^\n]*|\*\*Warunki wstępne:?\*\*[^\n]*)$/u;
const SHORT_STRUCTURAL_LIMIT = 80;
const GLOSSARY_SECTION_PATTERN = /(s[łl]ownik|glossary|definitions?)/iu;
const GLOSSARY_BULLET_PATTERN = /^\s*[-*+]\s+\*\*[^*\n]+\*\*\s*[:.\-—]/u;

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
    return consumeListBlock(lines, index, state);
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
  return consumeParagraph(lines, index, state);
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

function consumeListBlock(
  lines: LineSpan[],
  startIndex: number,
  state: ParseState,
): number {
  const start = lines[startIndex].start;
  let end = lines[startIndex].end;
  let i = startIndex + 1;

  while (i < lines.length) {
    const current = lines[i];
    if (isBlank(current.text)) break;
    if (HEADING_PATTERN.test(current.text)) break;
    if (FENCE_PATTERN.test(current.text)) break;
    if (!isListContinuation(current, lines[i - 1])) break;
    end = current.end;
    i++;
  }

  const sectionPath = state.currentPath;
  const consumed = i - startIndex;
  if (shouldSplitGlossary(sectionPath, lines, startIndex, i)) {
    emitGlossaryItems(lines, startIndex, i, state);
    return consumed;
  }

  pushFragment(state, "list", start, end, sliceText(lines, startIndex, i));
  return consumed;
}

function consumeParagraph(
  lines: LineSpan[],
  startIndex: number,
  state: ParseState,
): number {
  const start = lines[startIndex].start;
  let end = lines[startIndex].end;
  let i = startIndex + 1;

  while (i < lines.length) {
    const current = lines[i];
    if (isBlank(current.text)) break;
    if (HEADING_PATTERN.test(current.text)) break;
    if (FENCE_PATTERN.test(current.text)) break;
    if (!isParagraphContinuation(current, lines[i - 1])) break;
    end = current.end;
    i++;
  }

  const paragraphText = sliceText(lines, startIndex, i);
  const trimmedParagraph = paragraphText.trim();

  const followUp = locateFollowingBlock(lines, i);
  if (followUp !== null && isLeadInParagraph(trimmedParagraph)) {
    return consumeLeadInWithBlock(lines, startIndex, i, followUp, state);
  }

  if (isStructuralOrphan(trimmedParagraph)) {
    pushFragment(state, "structural", start, end, paragraphText);
    return i - startIndex;
  }

  pushFragment(state, "paragraph", start, end, paragraphText);
  return i - startIndex;
}

function consumeLeadInWithBlock(
  lines: LineSpan[],
  paragraphStart: number,
  paragraphEnd: number,
  followUp: FollowUpBlock,
  state: ParseState,
): number {
  const start = lines[paragraphStart].start;
  const end = lines[followUp.endIndex - 1].end;
  const text = sliceText(lines, paragraphStart, followUp.endIndex);
  pushFragment(state, followUp.kind, start, end, text);
  // Total lines consumed = paragraph block + skipped blanks + follow-up block
  return followUp.endIndex - paragraphStart;
  // followUp.startIndex >= paragraphEnd (blanks skipped) and endIndex > startIndex,
  // so this swallows the blank gap as part of one combined fragment.
  void paragraphEnd;
}

interface FollowUpBlock {
  kind: DocumentFragmentKind;
  startIndex: number;
  endIndex: number;
}

function locateFollowingBlock(
  lines: LineSpan[],
  paragraphEnd: number,
): FollowUpBlock | null {
  let i = paragraphEnd;
  while (i < lines.length && isBlank(lines[i].text)) i++;
  if (i >= lines.length) return null;
  const next = lines[i];
  if (HEADING_PATTERN.test(next.text)) return null;
  if (FENCE_PATTERN.test(next.text)) return null;

  if (LIST_ITEM_PATTERN.test(next.text)) {
    const endIndex = scanContinuation(lines, i, isListContinuation);
    return { kind: "list", startIndex: i, endIndex };
  }
  if (BLOCKQUOTE_PATTERN.test(next.text)) {
    const endIndex = scanContinuation(
      lines,
      i,
      (l) => BLOCKQUOTE_PATTERN.test(l.text),
    );
    return { kind: "blockquote", startIndex: i, endIndex };
  }
  if (TABLE_ROW_PATTERN.test(next.text)) {
    const endIndex = scanContinuation(
      lines,
      i,
      (l) => TABLE_ROW_PATTERN.test(l.text),
    );
    return { kind: "table", startIndex: i, endIndex };
  }
  return null;
}

function scanContinuation(
  lines: LineSpan[],
  startIndex: number,
  isContinuation: (line: LineSpan, prev: LineSpan) => boolean,
): number {
  let i = startIndex + 1;
  while (i < lines.length) {
    const current = lines[i];
    if (isBlank(current.text)) break;
    if (HEADING_PATTERN.test(current.text)) break;
    if (FENCE_PATTERN.test(current.text)) break;
    if (!isContinuation(current, lines[i - 1])) break;
    i++;
  }
  return i;
}

function isLeadInParagraph(text: string): boolean {
  if (text.length === 0 || text.length > 200) return false;
  if (text.includes("\n")) return false;
  if (/[:：]\s*$/u.test(text)) return true;
  if (STRUCTURAL_PARAGRAPH_PATTERN.test(text)) return true;
  return false;
}

function isStructuralOrphan(text: string): boolean {
  if (text.length === 0 || text.length > SHORT_STRUCTURAL_LIMIT) return false;
  if (text.includes("\n")) return false;
  return STRUCTURAL_PARAGRAPH_PATTERN.test(text);
}

function shouldSplitGlossary(
  sectionPath: string[],
  lines: LineSpan[],
  startIndex: number,
  endIndex: number,
): boolean {
  const sectionMatch = sectionPath.some((s) =>
    GLOSSARY_SECTION_PATTERN.test(s),
  );
  let topLevelBullets = 0;
  let glossaryShaped = 0;
  for (let i = startIndex; i < endIndex; i++) {
    const text = lines[i].text;
    if (TOP_LEVEL_LIST_ITEM_PATTERN.test(text)) {
      topLevelBullets++;
      if (GLOSSARY_BULLET_PATTERN.test(text)) glossaryShaped++;
    }
  }
  if (topLevelBullets < 3) return false;
  if (sectionMatch && topLevelBullets >= 3) return true;
  return glossaryShaped >= Math.max(3, Math.ceil(topLevelBullets * 0.6));
}

function emitGlossaryItems(
  lines: LineSpan[],
  startIndex: number,
  endIndex: number,
  state: ParseState,
): void {
  let bulletStart = -1;
  for (let i = startIndex; i < endIndex; i++) {
    if (TOP_LEVEL_LIST_ITEM_PATTERN.test(lines[i].text)) {
      if (bulletStart !== -1) {
        emitOneGlossaryItem(lines, bulletStart, i, state);
      }
      bulletStart = i;
    }
  }
  if (bulletStart !== -1) {
    emitOneGlossaryItem(lines, bulletStart, endIndex, state);
  }
}

function emitOneGlossaryItem(
  lines: LineSpan[],
  startIndex: number,
  endIndex: number,
  state: ParseState,
): void {
  const start = lines[startIndex].start;
  const end = lines[endIndex - 1].end;
  pushFragment(state, "list_item", start, end, sliceText(lines, startIndex, endIndex));
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
