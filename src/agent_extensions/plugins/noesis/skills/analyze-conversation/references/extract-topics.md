# Extract idea units and assign topics

Used by `noesis:analyze-conversation` Step 3.

## Cleaned-transcript format

`<transcript>-cleaned.md` looks like:

```
<!-- conversation_id: <id> -->
<!-- time: <YYYY-MM-DD HH:MM:SS> -->
<!-- main_topic: <text> -->

### [<turn_index>] <HH:MM:SS> — <speaker>
- <sentence 1>
- <sentence 2>

### [<turn_index>] <HH:MM:SS> — <speaker>
- <sentence ...>
```

Turn indices are stable — copy them verbatim into `Turn.index`.

## Idea units

For each turn, group consecutive sentences that form a cohesive unit of meaning into one `IdeaUnit`. A sentence belongs to exactly one idea unit. Idea-unit indices are sequential within the turn, starting from 0.

For each idea unit assign one or more categories from `IdeaUnitCategory`:

- `Information` — factual context.
- `Position` — opinion, proposal, stance.
- `Argument` — reasoning supporting a position.
- `Decision` — explicit agreement / chosen approach.
- `Irrelevant` — off-topic, social pleasantries, scheduling, audio issues, filler. Anything not connected to the system being designed.

Most idea units have exactly one category. Some genuinely span two (e.g. an argument that lands on a decision).

`Irrelevant` units are still recorded as idea units, but they are NOT assigned a topic.

## Topic assignment

Reuse before promote. Order of preference:

1. An existing topic from `potential_topics.json` fits → reference it by `id`.
2. An existing topic fits but the idea unit clearly opens a more specific concept → create a new subtopic with `is_new: true`, `parent_id: <existing id>`, fresh UUID, and a `path` built by appending the new title to the parent's path.
3. Nothing existing fits → create a new root topic with `is_new: true`, `parent_id: null`, fresh UUID, `path: [title]`.

Append every newly-created topic to `potential_topics.json` so the merge step can resolve `parent_id` correctly.

### Topic hierarchy rules

Think of topics as chapters in a system-design document. A software architect should be able to navigate the topic tree intuitively. Build a 2–3 level tree:

- **Root topics** — high-level business/system domains (e.g. "Inventory Management", "Pricing"). A conversation usually has 2–5 roots.
- **Functional areas** — children of roots covering distinct functional concerns.
- **Specific topics** — leaf-level for narrow self-contained concepts likely to recur in future conversations.

Guidelines:

- Aim for 3–7 children per parent. If a parent approaches 7 children, group related siblings under a new intermediate topic.
- Create intermediate groupings proactively when two or more new subtopics share a theme.
- Do NOT create a subtopic for a single idea unit unless it represents a self-contained, recurring concept.
- Depth over breadth: a deep, well-organized 3–5 root tree beats a flat 10+ root list.

## Conversation JSON shape

Overwrite `<working_dir>/conversation.json` with:

```json
{
  "conversation_id": "<id>",
  "time": "<conversation_time>",
  "main_topic": "<main_topic>",
  "turns": [
    {
      "index": 0,
      "speaker": "Alice",
      "time": "00:00:30",
      "idea_units": [
        { "index": 0, "sentences": ["..."], "categories": ["Information"] }
      ]
    }
  ],
  "topics": [
    {
      "id": "<uuid>",
      "title": "...",
      "short_summary": "",
      "long_summary": "",
      "items": [
        { "type": "idea_unit_ref", "conversation_id": "<id>", "turn_index": 0, "idea_unit_index": 0 }
      ],
      "decisions": [],
      "reviewed": false,
      "decisions_extracted": false
    }
  ]
}
```

Leave `short_summary`, `long_summary`, and `decisions` unset (empty / `[]`) at this step — Step 4 fills them.

## Language

Generate all titles in the same language as the transcript. Do not switch to English for technical content.
