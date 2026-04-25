# Assign categories and topics to fragments

Used by `noesis:analyze-design-draft` Step 3.

## Inputs

- `<cleaned_path>` — the cleaned source document (Markdown). Use it to read fragment content in context.
- `<analysis_path>` — `analysis.json`. The `fragments` array is pre-populated by the prep script:
  ```json
  {
    "index": 0,
    "start_offset": 0,
    "end_offset": 42,
    "section_path": ["Section A"],
    "kind": "paragraph|list|code_block|table|blockquote",
    "text": "...",
    "categories": []
  }
  ```
- `<section_tree_path>` — Markdown rendering of the heading hierarchy. Useful for orientation, optional.
- `{working_dir}/potential_topics.json` — existing topics from the graph plus any new topics you introduce.

Treat fragment indices and offsets as authoritative — copy them verbatim into `DocumentFragmentRef`.

## Categories

Per fragment, assign one or more from `IdeaUnitCategory`:

- `Information` — most fragments in design drafts. Factual content, descriptions, requirements.
- `Position` — author asserts a stance or recommendation.
- `Argument` — reasoning that supports a position.
- `Decision` — chosen approach with rationale (e.g. "Use X because Y", "Decision: …", explicit trade-offs landing on a choice).
- `Irrelevant` — genuinely off-topic. Rare in author-curated documents — boilerplate, pure rhetoric, uncited tangents.

Most fragments are `Information` only. Combine categories only when both genuinely apply.

## Topic assignment

Reuse before promote. For every non-Irrelevant fragment:

1. Existing topic in `potential_topics.json` fits → reference it by `id`.
2. Existing topic fits but the fragment opens a more specific concept → new subtopic (`is_new: true`, `parent_id: <existing>`, fresh UUID, path appended).
3. Nothing existing fits → new root topic (`is_new: true`, `parent_id: null`, fresh UUID, path `[title]`).

`section_path` is a HINT, not authoritative. A single section may map to one topic, split across multiple subtopics, or merge with sibling sections.

Append every newly-created topic to `potential_topics.json` so `merge_document` can wire `parent_id` correctly.

### Topic hierarchy rules

Build a 2–3 level tree. Aim for 3–7 children per parent. Group related new subtopics under a shared intermediate parent rather than dropping them flat. Don't create a subtopic for a single fragment unless it is a self-contained, recurring concept.

A document typically maps to 1–5 root topics. Depth over breadth: a deep, well-organized 3–5 root tree beats a flat 10+ root list.

## Updating analysis.json

For each fragment, set its `categories` array (do not move/reorder fragments).

Build `topics: [...]` — one `Topic` per touched topic id:

```json
{
  "id": "<uuid>",
  "title": "...",
  "short_summary": "",
  "long_summary": "",
  "items": [
    { "type": "document_fragment_ref", "document_id": "<doc_id>", "start_offset": N, "end_offset": N }
  ],
  "decisions": [],
  "reviewed": false,
  "decisions_extracted": false
}
```

`document_id` matches `analysis.json`'s top-level `document_id`. `start_offset` / `end_offset` come from the fragment.

Leave summaries and decisions empty here — Step 5 fills them.

Skip Irrelevant fragments when populating topic `items`.

## Language

Match the source document's language for all titles. Do not switch to English for technical content.
