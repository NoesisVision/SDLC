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

**Transitional interjections** (one-word acknowledgements like *"yes"*, *"okay"*, *"hmm"*, *"tak"*, *"dobrze"*, *"słucham?"*) should be merged into the surrounding idea unit when they don't carry meaning on their own. Do not emit them as standalone idea units. The exception is when the interjection is itself the substantive content of a turn — e.g. an answer to a yes/no question that the next speaker depends on; in that case keep it as its own idea unit and pair it with the appropriate category.

For each idea unit assign one or more categories from `IdeaUnitCategory`:

- `Information` — factual context.
- `Position` — opinion, proposal, stance.
- `Argument` — reasoning supporting a position.
- `Decision` — a unit that **commits** the speaker (or the group) to a course of action. To qualify, the unit must itself name the chosen course; agreement on its own is not enough.

  **Acknowledgement tokens** (`"yes"`, `"okay"`, `"tak"`, `"dobrze"`, `"jasne"`) should rarely be standalone idea units — group them into the surrounding idea unit that contains the actual commitment (see "Transitional interjections" above). When an acknowledgement does end up as its own idea unit, it is almost always `Irrelevant`, not `Decision`: the load-bearing content is in the previous or next idea unit, which is the one that carries `Decision` if any.

  Conversely, narrative-style commitments without explicit decision wording still qualify. Examples:

  - *"I'm not sure I want to drop it"* (Polish: *"nie wiem czy chcę z niej rezygnować"*) → `Decision` if it states the speaker's settled stance.
  - *"We'll go with the FIFO approach because…"* → `Decision` (the chosen course is named).
  - *"Yes."* / *"Tak."* alone → not a Decision; merge into the surrounding IU.

- `Irrelevant` — off-topic, social pleasantries, scheduling, audio issues, filler. Anything not connected to the system being designed.

Most idea units have exactly one category. Some genuinely span two (e.g. an argument that lands on a decision).

`Irrelevant` units are still recorded as idea units, but they are NOT assigned a topic.

## Topic assignment

Reuse before promote. Order of preference:

1. An existing topic from `output.json:potential_topics.topics` fits → reference it by `id`.
2. An existing topic fits but the idea unit clearly opens a more specific concept → create a new subtopic with `is_new: true`, `parent_id: <existing id>`, fresh id (see "Topic ids" below), and a `path` built by appending the new title to the parent's path.
3. Nothing existing fits → create a new root topic with `is_new: true`, `parent_id: null`, fresh id, `path: [title]`.

For every newly-created topic, append an entry to `output.json:potential_topics.topics` with `is_new: true`. Set `parent_id` to the existing parent's id, or to `null` if the topic is a new root.

### Topic ids

Do not invent topic ids yourself. Once you know how many new topics you need, call MCP tool `noesis-graph:generate_topic_ids` with `{ "count": <N> }` and use the returned ids for both `conversation.topics[].id` and the matching `potential_topics.topics[].id` (with `is_new: true`). If you discover during Step 4 that an additional topic is required, call `generate_topic_ids` again with `{ "count": 1 }`.

### Topic hierarchy

Topics form a hierarchy that humans must be able to navigate. The agent's job is to keep that hierarchy legible.

1. **Single root per conversation when possible.** Most conversations have one root topic that frames the subject. Multiple unrelated roots are a smell — usually they should hang under a shared parent that names what binds them.
2. **First-level breadth ≤ 10.** No more than ~10 sibling topics directly under a root. If the categorisation axis produces more, group along a coarser axis and demote the current ones one level down.
3. **Reuse the existing structure.** Before adding a new topic — and especially before adding a new first-level topic — read the existing topic tree end to end. New topics at the first level are added only when no existing branch fits.
4. **Re-shape when needed.** Merging, splitting, and re-parenting existing topics is part of the job, not an exception. If a previously created topic no longer fits the cleaned conversation's structure, change it.
5. **Reason from semantic axes, not counts.** Item count is a smell, not a verdict. A 1-item topic is fine if it is genuinely orthogonal; a 30-item topic is fine if all 30 belong to one tightly-coupled algorithm.

Container topics — parents whose own `items` list is empty because all idea units sit on subtopics — are legitimate. They give the tree shape and act like chapters in a system-design document. Their summaries are written from their children's summaries (see "Summaries when a topic has subtopics" in `analyze-topic.md`); never leave them blank.

## Output JSON shape

`<working_dir>/output.json` (the file initialised by `prepare.ts`) wraps the conversation and the potential-topics list:

```json
{
  "conversation": {
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
        "id": "<topic id from generate_topic_ids>",
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
  },
  "potential_topics": {
    "topics": [
      {
        "id": "<same id as conversation.topics[].id when is_new>",
        "title": "...",
        "short_summary": "",
        "path": ["..."],
        "is_new": true,
        "parent_id": null
      }
    ]
  }
}
```

`conversation.topics[].id` and the matching `potential_topics.topics[].id` (with `is_new: true`) MUST be the same value. The canonical schema lives at `shared-contracts/skills/analyze-conversation/output.ts` (`AnalyzeConversationOutputSchema`).

Leave `short_summary`, `long_summary`, and `decisions` unset (empty / `[]`) at this step — they are produced in Step 4.

## Language

Generate all titles in the same language as the transcript. Do not switch to English for technical content.
