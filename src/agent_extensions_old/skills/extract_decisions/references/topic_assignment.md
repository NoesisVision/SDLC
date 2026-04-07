# Topic Assignment

## Core Rule

Assign each non-Irrelevant idea unit to exactly **one** topic. Irrelevant units go to `discarded_units`.

## Choosing a Topic

1. **Scan existing topics** — read the topic summaries loaded via `load_topics.py`.
2. **Match by relevance** — if the idea unit clearly relates to an existing topic's subject matter, assign it there.
3. **Create a new topic** — if no existing topic fits, create a new one with a `placeholder_id` (e.g. `"new_1"`, `"new_2"`).

## When to Load Detailed Descriptions

If two or more existing topics seem equally relevant for an idea unit, load their detailed descriptions via `load_topics.py --detail-ids` and re-evaluate. The full description and existing idea unit count provide disambiguation context.

## Topic Naming

- Use **2-5 words**, noun phrases (e.g. "User Authentication Flow", "Database Migration Strategy").
- Write topic names **in the same language as the conversation**.
- Names should be specific enough to distinguish from other topics.

## Cross-cutting Units

When an idea unit touches multiple topics, assign it to the topic where it has the **strongest relevance** — the topic whose core question or subject the unit most directly addresses. Do not duplicate the unit across topics.

## Agreement and Decision Units

- **Agreement** units: assign to the topic where the endorsed position lives.
- **Decision** units: assign to the topic where the debated decision or action item belongs.
