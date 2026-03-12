# Agent Instructions

## Task

Extract software design decisions from the conversation transcript at `/app/transcript.md`.

## Approach

1. Read the full transcript at `/app/transcript.md`.
2. Explore the codebase at `/app/repo/` to understand the technical context of the discussion.
3. Identify all software design decisions made during the conversation.
4. For each decision, write a JSON file to `/app/output/decisions/` following the schema below.
5. Write a structured conversation summary to `/app/output/structured.json` following the schema below.

## Decision Record Schema (`/app/output/decisions/*.json`)

Name files descriptively (e.g., `topic_001_decision_001.json`).

```json
{
  "topic_id": "topic_001",
  "topic_name": "Short topic name (2-5 words)",
  "context": "Problem description — what issue or question was being discussed",
  "decision": {
    "description": "What was decided",
    "rationale": "Why this option was chosen",
    "consequences": "Expected outcomes and trade-offs"
  },
  "alternative_options": [
    {
      "description": "What this alternative entails",
      "rejection_rationale": "Why it was not chosen"
    }
  ],
  "design_concerns": ["Technology", "QualityAttribute"]
}
```

Valid `design_concerns`: `BusinessRule`, `DomainModel`, `QualityAttribute`, `Technology`, `Infrastructure`, `Other`

## Structured Summary Schema (`/app/output/structured.json`)

```json
{
  "conversation_id": "UUID string",
  "title": "Conversation title",
  "date": "YYYY-MM-DD HH:MM",
  "topics": [
    {
      "topic_id": "topic_001",
      "name": "2-5 word topic name",
      "summary": "Dense summary, max 50 tokens",
      "description": "Comprehensive description, max 500 tokens",
      "idea_units": [
        {
          "turn_id": "turn_001",
          "speaker": "Speaker Name",
          "time": "YYYY-MM-DD HH:MM",
          "sentences": ["sentence1", "sentence2"],
          "category": "Issue|Position|Argument|Information|Agreement|Decision"
        }
      ]
    }
  ]
}
```

## Scope

Only extract **software design decisions** — technology choices, architecture, API design, data models, quality attributes. Ignore organizational and project management discussions.
