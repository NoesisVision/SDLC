# Task: Extract Software Design Decisions

You are given a transcript of a team architecture review meeting and access to the discussed codebase.

## Input

- **Transcript**: `/app/transcript.md` — a conversation between team members discussing software architecture decisions
- **Codebase**: `/app/repo/` — the DDD-starter-dotnet repository referenced in the discussion

## What to do

1. Read the transcript carefully and identify all **software design decisions** made during the conversation.
2. For each decision, cross-reference with the actual codebase at `/app/repo/` to understand the technical context.
3. Write each decision as a separate JSON file in `/app/output/decisions/`.
4. Write a structured summary of the entire conversation to `/app/output/structured.json`.

## Output Format

### Decision files (`/app/output/decisions/*.json`)

Each file should follow this schema:

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

Valid `design_concerns` values: `BusinessRule`, `DomainModel`, `QualityAttribute`, `Technology`, `Infrastructure`, `Other`

### Structured summary (`/app/output/structured.json`)

```json
{
  "conversation_id": "UUID string",
  "title": "Conversation title",
  "date": "YYYY-MM-DD HH:MM",
  "topics": [
    {
      "topic_id": "topic_001",
      "name": "2-5 word topic name",
      "short_description": "Dense summary, max 50 tokens",
      "long_description": "Comprehensive description, max 500 tokens",
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

Only extract **software design and implementation decisions** — technology choices, architecture, API design, data models, quality attributes. Ignore organizational, business, and project management discussions.

## Important

- Cross-reference the codebase to verify file names, class names, and patterns mentioned in the discussion.
- Include all alternatives that were discussed, even if briefly.
- Capture the rationale faithfully — use the speakers' actual reasoning, not your own judgement.
- Note any team disagreements in the context or rationale.
