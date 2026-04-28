import { describe, expect, test } from "bun:test";
import { readFileSync } from "fs";
import { join } from "path";
import { fragmentMarkdown } from "./fragment-markdown.js";

describe("fragmentMarkdown — basic blocks", () => {
  test("monologue (no headings) produces fragments without section paths", () => {
    const md = ["First paragraph.", "", "Second paragraph spans", "two lines.", ""].join("\n");
    const result = fragmentMarkdown(md);

    expect(result.section_tree).toEqual([]);
    expect(result.fragments).toHaveLength(2);
    expect(result.fragments[0].kind).toBe("paragraph");
    expect(result.fragments[0].section_path).toEqual([]);
    expect(result.fragments[0].text).toBe("First paragraph.");
    expect(result.fragments[1].text).toBe("Second paragraph spans\ntwo lines.");
  });

  test("headings build a hierarchical section tree", () => {
    const md = [
      "# Top",
      "",
      "Intro paragraph.",
      "",
      "## Sub A",
      "",
      "Body of sub A.",
      "",
      "## Sub B",
      "",
      "Body of sub B.",
      "",
      "# Other",
      "",
      "Other body.",
    ].join("\n");
    const result = fragmentMarkdown(md);

    expect(result.section_tree).toHaveLength(2);
    expect(result.section_tree[0].title).toBe("Top");
    expect(result.section_tree[0].children).toHaveLength(2);
    expect(result.section_tree[0].children[0].title).toBe("Sub A");
    expect(result.section_tree[0].children[1].title).toBe("Sub B");
    expect(result.section_tree[1].title).toBe("Other");

    expect(result.fragments).toHaveLength(4);
    expect(result.fragments[0].section_path).toEqual(["Top"]);
    expect(result.fragments[1].section_path).toEqual(["Top", "Sub A"]);
    expect(result.fragments[2].section_path).toEqual(["Top", "Sub B"]);
    expect(result.fragments[3].section_path).toEqual(["Other"]);
  });

  test("offsets reference back into the original content", () => {
    const md = "# Title\n\nFirst paragraph.\n\nSecond paragraph.\n";
    const result = fragmentMarkdown(md);

    for (const fragment of result.fragments) {
      const slice = md.slice(fragment.start_offset, fragment.end_offset);
      expect(slice.trim()).toBe(fragment.text);
    }
  });

  test("code fences are emitted as a single fragment, including content", () => {
    const md = [
      "# Code",
      "",
      "Before.",
      "",
      "```python",
      "def hello():",
      "    return 1",
      "```",
      "",
      "After.",
    ].join("\n");
    const result = fragmentMarkdown(md);
    const code = result.fragments.find((f) => f.kind === "code_block");
    expect(code).toBeDefined();
    expect(code!.text).toContain("```python");
    expect(code!.text).toContain("def hello():");
    expect(code!.text).toContain("```");
  });

  test("headings inside fenced code blocks are not promoted to sections", () => {
    const md = ["# Real", "", "```", "# Not a heading", "more code", "```", ""].join("\n");
    const result = fragmentMarkdown(md);
    expect(result.section_tree).toHaveLength(1);
    expect(result.section_tree[0].title).toBe("Real");
  });

  test("bullet list collapses into one fragment", () => {
    const md = ["# T", "", "- item 1", "- item 2", "- item 3", ""].join("\n");
    const result = fragmentMarkdown(md);
    const lists = result.fragments.filter((f) => f.kind === "list");
    expect(lists).toHaveLength(1);
    expect(lists[0].text).toContain("item 1");
    expect(lists[0].text).toContain("item 3");
  });

  test("table rows collapse into one fragment", () => {
    const md = ["# T", "", "| a | b |", "|---|---|", "| 1 | 2 |", ""].join("\n");
    const result = fragmentMarkdown(md);
    const tables = result.fragments.filter((f) => f.kind === "table");
    expect(tables).toHaveLength(1);
    expect(tables[0].text).toContain("| a | b |");
    expect(tables[0].text).toContain("| 1 | 2 |");
  });

  test("blockquote groups into one fragment", () => {
    const md = ["# T", "", "> first", "> second", ""].join("\n");
    const result = fragmentMarkdown(md);
    const quotes = result.fragments.filter((f) => f.kind === "blockquote");
    expect(quotes).toHaveLength(1);
    expect(quotes[0].text).toContain("first");
    expect(quotes[0].text).toContain("second");
  });

  test("HTML comment on first line is ignored", () => {
    const md = "<!-- document_id: abc -->\n# T\n\nBody.\n";
    const result = fragmentMarkdown(md);
    expect(result.section_tree).toHaveLength(1);
    expect(result.fragments).toHaveLength(1);
    expect(result.fragments[0].text).toBe("Body.");
  });

  test("section fragment_indices line up with fragments belonging to that section", () => {
    const md = [
      "# A",
      "",
      "Para a1.",
      "",
      "Para a2.",
      "",
      "## A.1",
      "",
      "Para a1_1.",
    ].join("\n");
    const result = fragmentMarkdown(md);
    const top = result.section_tree[0];
    expect(top.fragment_indices).toEqual([0, 1]);
    expect(top.children[0].fragment_indices).toEqual([2]);
  });
});

describe("fragmentMarkdown — header collapsing", () => {
  test("`**Header:** + bullet list` collapses into one list fragment", () => {
    const md = [
      "# Section",
      "",
      "**Warunki wstępne:**",
      "",
      "- order is paid",
      "- inventory reserved",
      "",
    ].join("\n");
    const result = fragmentMarkdown(md);
    expect(result.fragments).toHaveLength(1);
    const f = result.fragments[0];
    expect(f.kind).toBe("list");
    expect(f.text).toContain("**Warunki wstępne:**");
    expect(f.text).toContain("- order is paid");
    expect(f.text).toContain("- inventory reserved");
  });

  test("`*Wariant A:* + bullet list` collapses into one fragment", () => {
    const md = [
      "# UC",
      "",
      "*Wariant A: cancellation*",
      "",
      "- step 1",
      "- step 2",
    ].join("\n");
    const result = fragmentMarkdown(md);
    expect(result.fragments).toHaveLength(1);
    expect(result.fragments[0].kind).toBe("list");
    expect(result.fragments[0].text).toContain("*Wariant A: cancellation*");
  });

  test("`Header:` followed by table collapses into one table fragment", () => {
    const md = [
      "# Section",
      "",
      "**Tabela kosztów:**",
      "",
      "| a | b |",
      "|---|---|",
      "| 1 | 2 |",
    ].join("\n");
    const result = fragmentMarkdown(md);
    expect(result.fragments).toHaveLength(1);
    expect(result.fragments[0].kind).toBe("table");
    expect(result.fragments[0].text).toContain("**Tabela kosztów:**");
  });

  test("orphan `**Powiązane scenariusze:**` paragraph emits structural kind", () => {
    const md = [
      "# Section",
      "",
      "Body paragraph here.",
      "",
      "**Powiązane scenariusze:**",
      "",
      "## Next section",
      "",
      "More content.",
    ].join("\n");
    const result = fragmentMarkdown(md);
    const structurals = result.fragments.filter((f) => f.kind === "structural");
    expect(structurals).toHaveLength(1);
    expect(structurals[0].text).toBe("**Powiązane scenariusze:**");
  });

  test("regular paragraph followed by non-block content stays paragraph", () => {
    const md = [
      "# Section",
      "",
      "Pierwszy akapit kończy się normalnym tekstem.",
      "",
      "Drugi akapit, niezależny.",
    ].join("\n");
    const result = fragmentMarkdown(md);
    const paragraphs = result.fragments.filter((f) => f.kind === "paragraph");
    expect(paragraphs).toHaveLength(2);
  });

  test("paragraph not ending with colon is not collapsed into following list", () => {
    const md = [
      "# Section",
      "",
      "This is a normal paragraph that introduces a topic.",
      "",
      "- bullet 1",
      "- bullet 2",
    ].join("\n");
    const result = fragmentMarkdown(md);
    const kinds = result.fragments.map((f) => f.kind);
    expect(kinds).toEqual(["paragraph", "list"]);
  });
});

describe("fragmentMarkdown — glossary list splitting", () => {
  test("list inside a `Słownik` section splits into per-bullet list_item fragments", () => {
    const md = [
      "# Słownik pojęć",
      "",
      "## Dokumenty i obiekty",
      "",
      "- **PriceState**: bieżący stan cenowy.",
      "- **Delta**: rejestrowana zmiana wartości.",
      "- **Lock**: blokada ilości.",
      "- **Pending**: oczekująca blokada.",
    ].join("\n");
    const result = fragmentMarkdown(md);
    const items = result.fragments.filter((f) => f.kind === "list_item");
    expect(items).toHaveLength(4);
    expect(items[0].text).toContain("PriceState");
    expect(items[1].text).toContain("Delta");
    expect(items[2].text).toContain("Lock");
    expect(items[3].text).toContain("Pending");
  });

  test("non-glossary list under regular section is NOT split", () => {
    const md = [
      "# Wymagania",
      "",
      "- pierwszy wymóg",
      "- drugi wymóg",
      "- trzeci wymóg",
    ].join("\n");
    const result = fragmentMarkdown(md);
    const lists = result.fragments.filter((f) => f.kind === "list");
    expect(lists).toHaveLength(1);
    expect(result.fragments.filter((f) => f.kind === "list_item")).toHaveLength(0);
  });

  test("list with majority of glossary-shaped bullets is split even outside glossary section", () => {
    const md = [
      "# Definicje robocze",
      "",
      "- **Alpha**: pierwszy",
      "- **Beta**: drugi",
      "- **Gamma**: trzeci",
      "- regular bullet without bold",
    ].join("\n");
    const result = fragmentMarkdown(md);
    const items = result.fragments.filter((f) => f.kind === "list_item");
    expect(items.length).toBe(4);
  });
});

describe("fragmentMarkdown — PageIndex sample", () => {
  test("processes the PageIndex draft into a non-trivial tree", () => {
    const samplePath = join(import.meta.dirname, "..", "..", "skills", "analyze-design-draft", "analysis-pageindex-tree-algorithms.md");
    const content = readFileSync(samplePath, "utf-8");
    const result = fragmentMarkdown(content);

    expect(result.section_tree.length).toBeGreaterThan(0);
    const titles = result.section_tree.map((s) => s.title);
    expect(titles[0]).toContain("PageIndex Tree Algorithms");

    const part1 = result.section_tree[0].children.find((c) => c.title.startsWith("Part 1"));
    const part2 = result.section_tree[0].children.find((c) => c.title.startsWith("Part 2"));
    expect(part1).toBeDefined();
    expect(part2).toBeDefined();

    expect(result.fragments.length).toBeGreaterThan(50);
    const codeBlocks = result.fragments.filter((f) => f.kind === "code_block");
    expect(codeBlocks.length).toBeGreaterThan(5);
    const tables = result.fragments.filter((f) => f.kind === "table");
    expect(tables.length).toBeGreaterThanOrEqual(2);

    for (const fragment of result.fragments) {
      expect(fragment.start_offset).toBeLessThan(fragment.end_offset);
      expect(fragment.end_offset).toBeLessThanOrEqual(content.length);
    }
  });
});
