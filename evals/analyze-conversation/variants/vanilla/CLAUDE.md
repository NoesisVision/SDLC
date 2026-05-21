# Agent Instructions — vanilla (no skill)

You must complete the task in `/app/instruction.md` using only your own
reasoning. There is **no analyze-conversation skill** available to you and you
should not rely on any project tooling or MCP server.

## Deliverable

Read `/app/transcript.md` and produce a single file `/app/output.json` that
matches this schema exactly:

```jsonc
{
  "conversation": {
    "conversation_id": "<sha-256 of the raw transcript bytes, formatted as a UUID 8-4-4-4-12>",
    "time": "2026-05-18 10:00:00",
    "main_topic": "Parcel locker pickup-code expiry and retry design",
    "turns": [
      {
        "index": 0,                       // 0-based, contiguous, in transcript order
        "speaker": "Maya",
        "time": "00:00:00",               // HH:MM:SS
        "idea_units": [
          {
            "index": 0,                   // 0-based per turn
            "sentences": ["...", "..."],  // consecutive sentences forming one idea
            "categories": ["Information"] // subset of: Information, Position, Argument, Decision, Irrelevant
          }
        ]
      }
    ],
    "topics": [
      {
        "id": "<uuid>",
        "parent_id": null,                // or another topic's id
        "is_new": true,
        "title": "...",
        "short_summary": "<=3 sentences, search-optimized",
        "long_summary": "10-20 sentences, established knowledge (no 'the team discussed')",
        "items": [
          { "type": "idea_unit_ref", "conversation_id": "<id>", "turn_index": 0, "idea_unit_index": 0 }
        ],
        "decisions": [
          {
            "title": "...",
            "status": "accepted",        // or "proposed"
            "context": { "text": "...", "supporting_content": [ /* idea_unit_ref[] */ ] },
            "decision": { "text": "...", "rationale": "...", "supporting_content": [ /* idea_unit_ref[] */ ] },
            "alternative_options": [
              { "text": "...", "rationale": "...", "supporting_content": [ /* idea_unit_ref[] */ ] }
            ]
          }
        ],
        "reviewed": true,
        "decisions_extracted": true
      }
    ]
  }
}
```

## Rules

- `conversation_id` is the SHA-256 of the **raw** `/app/transcript.md` bytes,
  rendered as a UUID (`8-4-4-4-12`). Compute it; do not invent one.
- Every idea unit belongs to exactly one topic **unless** it is purely
  `Irrelevant` (social filler, greetings, scheduling, audio checks) — those are
  still recorded as idea units but are assigned to NO topic.
- Acknowledgement tokens ("Yes.", "Okay.") that merely accept a point already
  made are not decisions; a standalone "Yes." that is the load-bearing answer to
  a yes/no question is.
- Capture what was actually adopted versus what was proposed then dropped
  (dropped options go in `alternative_options`). Use `status: "proposed"` when a
  discussion did not converge.
- English for all titles, summaries and free text.
