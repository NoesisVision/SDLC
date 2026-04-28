import { describe, expect, test } from "bun:test";
import { formatTopicList } from "./topics.mcp.js";
import type { TopicOverview } from "./topics.repository.js";

function makeTopic(overrides: Partial<TopicOverview> = {}): TopicOverview {
  return {
    id: "t-1",
    title: "Sample",
    short_summary: "Short.",
    long_summary: "Long body that should never appear in the listing.",
    has_subtopics: false,
    path: ["Sample"],
    ...overrides,
  };
}

describe("formatTopicList", () => {
  test("omits long_summary from every row", () => {
    const md = formatTopicList(
      [
        makeTopic({ id: "a", title: "Alpha" }),
        makeTopic({ id: "b", title: "Beta" }),
      ],
      null,
    );
    expect(md).not.toContain("Long summary");
    expect(md).not.toContain("Long body that should never appear");
  });

  test("includes id, title, path, has_subtopics, short_summary", () => {
    const md = formatTopicList(
      [
        makeTopic({
          id: "abc",
          title: "Alpha",
          path: ["Root", "Alpha"],
          has_subtopics: true,
          short_summary: "Hello.",
        }),
      ],
      "parent-id",
    );
    expect(md).toContain("# Subtopics of parent-id");
    expect(md).toContain("## Alpha");
    expect(md).toContain("**ID:** abc");
    expect(md).toContain("**Path:** Root / Alpha");
    expect(md).toContain("**Has subtopics:** yes");
    expect(md).toContain("**Short summary:** Hello.");
  });

  test("renders empty short_summary as (empty)", () => {
    const md = formatTopicList([makeTopic({ short_summary: "" })], null);
    expect(md).toContain("**Short summary:** (empty)");
  });

  test("returns (none) when no topics", () => {
    expect(formatTopicList([], null)).toBe("# Root topics\n\n(none)");
    expect(formatTopicList([], "p1")).toBe("# Subtopics of p1\n\n(none)");
  });

  test("listing 50 topics fits comfortably below the 25k token Read window", () => {
    const topics: TopicOverview[] = [];
    const longBody = "X".repeat(2000);
    for (let i = 0; i < 50; i++) {
      topics.push(
        makeTopic({
          id: `topic-${i}`,
          title: `Topic ${i}`,
          short_summary: `Short summary number ${i}.`,
          long_summary: longBody,
          has_subtopics: i % 3 === 0,
          path: ["Root", `Topic ${i}`],
        }),
      );
    }
    const md = formatTopicList(topics, null);
    expect(md).not.toContain(longBody);
    expect(md.length).toBeLessThan(20_000);
  });
});
