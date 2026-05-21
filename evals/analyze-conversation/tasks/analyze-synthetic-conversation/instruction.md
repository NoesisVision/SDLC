# Task: Analyze a conversation transcript into the knowledge graph

You are given the raw Markdown transcript of a software design meeting at
`/app/transcript.md`. The meeting designs a parcel-locker pickup-code subsystem
(code expiry, storage, retry/lockout, validity duration).

## Inputs

- **Transcript**: `/app/transcript.md` — raw, un-cleaned conversation.
- **conversation_time**: `2026-05-18 10:00:00`
- **main_topic**: `Parcel locker pickup-code expiry and retry design`

## What to do

Analyze the conversation and integrate it into the noesis knowledge graph:

1. Segment the transcript into turns and idea units, and categorize each idea
   unit (`Information`, `Position`, `Argument`, `Decision`, `Irrelevant`).
2. Organize the non-irrelevant content into a topic hierarchy. The graph is not
   empty — reuse existing topics where they fit rather than creating duplicates.
3. Write a search-optimized short summary and a knowledge-oriented long summary
   for every topic.
4. Extract the design decisions, each with its context, the adopted decision and
   rationale, and any alternatives that were considered and rejected.
5. Persist the result into the knowledge graph.

## Notes

- The transcript contains social filler and acknowledgements that are not part
  of the system being designed — handle them appropriately.
- Some proposals raised early were later overturned; capture what was actually
  adopted versus what was considered and dropped.
- Not every discussion reached a firm conclusion.

The environment is preconfigured with everything you need to do this. Use the
tooling available to you; do not invent your own graph format if a canonical one
is provided.
