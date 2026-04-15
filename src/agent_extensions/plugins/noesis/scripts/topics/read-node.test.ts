import { describe, expect, test } from "bun:test";
import { readNode } from "./read-node.js";
import type { Topic } from "./types.js";

function makeTopic(id: string, title: string, subtopics: Topic[] = []): Topic {
  return {
    id,
    title,
    short_summary: `Short: ${title}`,
    long_summary: `Long: ${title}`,
    idea_units: [],
    subtopics,
    reviewed: false,
    decisions_extracted: false,
  };
}

const topics: Topic[] = [
  makeTopic("t1", "Architecture", [
    makeTopic("t1a", "Microservices", [
      makeTopic("t1a1", "Service Mesh"),
    ]),
    makeTopic("t1b", "Monolith"),
  ]),
  makeTopic("t2", "Performance"),
];

describe("readNode", () => {
  test("returns root topic with path", () => {
    const result = readNode(topics, "t2");
    expect(result).toEqual({
      id: "t2",
      title: "Performance",
      path: ["Performance"],
      short_summary: "Short: Performance",
      long_summary: "Long: Performance",
    });
  });

  test("returns nested topic with full path", () => {
    const result = readNode(topics, "t1a");
    expect(result).toEqual({
      id: "t1a",
      title: "Microservices",
      path: ["Architecture", "Microservices"],
      short_summary: "Short: Microservices",
      long_summary: "Long: Microservices",
    });
  });

  test("returns deeply nested topic with full path", () => {
    const result = readNode(topics, "t1a1");
    expect(result).toEqual({
      id: "t1a1",
      title: "Service Mesh",
      path: ["Architecture", "Microservices", "Service Mesh"],
      short_summary: "Short: Service Mesh",
      long_summary: "Long: Service Mesh",
    });
  });

  test("returns null for unknown ID", () => {
    const result = readNode(topics, "unknown");
    expect(result).toBeNull();
  });

  test("returns null for empty topics", () => {
    const result = readNode([], "t1");
    expect(result).toBeNull();
  });
});
