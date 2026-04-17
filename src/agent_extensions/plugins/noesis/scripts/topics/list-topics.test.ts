import { describe, expect, test } from "bun:test";
import { listTopics } from "./list-topics.js";
import type { Topic } from "../../shared-contracts/topics.js";

function makeTopic(id: string, title: string, subtopics: Topic[] = []): Topic {
  return {
    id,
    title,
    short_summary: `Summary of ${title}`,
    long_summary: `Long summary of ${title}`,
    items: [],
    subtopics,
    reviewed: false,
    decisions_extracted: false,
  };
}

const topics: Topic[] = [
  makeTopic("t1", "Architecture", [
    makeTopic("t1a", "Microservices"),
    makeTopic("t1b", "Monolith"),
  ]),
  makeTopic("t2", "Performance"),
];

describe("listTopics", () => {
  test("returns root topics when no parent ID", () => {
    const result = listTopics(topics, null);
    expect(result).toHaveLength(2);
    expect(result[0].id).toBe("t1");
    expect(result[0].has_subtopics).toBe(true);
    expect(result[0].path).toEqual(["Architecture"]);
    expect(result[1].id).toBe("t2");
    expect(result[1].has_subtopics).toBe(false);
    expect(result[1].path).toEqual(["Performance"]);
  });

  test("returns subtopics for given parent ID", () => {
    const result = listTopics(topics, "t1");
    expect(result).toHaveLength(2);
    expect(result[0].id).toBe("t1a");
    expect(result[0].path).toEqual(["Architecture", "Microservices"]);
    expect(result[1].id).toBe("t1b");
    expect(result[1].path).toEqual(["Architecture", "Monolith"]);
  });

  test("returns empty array for unknown parent ID", () => {
    const result = listTopics(topics, "unknown");
    expect(result).toEqual([]);
  });

  test("returns empty array for empty topics", () => {
    const result = listTopics([], null);
    expect(result).toEqual([]);
  });

  test("includes all overview fields", () => {
    const result = listTopics(topics, null);
    expect(result[0]).toEqual({
      id: "t1",
      title: "Architecture",
      short_summary: "Summary of Architecture",
      long_summary: "Long summary of Architecture",
      has_subtopics: true,
      path: ["Architecture"],
    });
  });
});
