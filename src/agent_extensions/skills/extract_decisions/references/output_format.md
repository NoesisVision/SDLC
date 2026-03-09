# Structured Conversation Output Format

The final output is a JSON file placed next to the original conversation file with a `_structured.json` suffix.

## Schema

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

## Field Descriptions

### Top Level

| Field | Type | Description |
|-------|------|-------------|
| `conversation_id` | string | UUID v4 identifying the conversation |
| `title` | string | Title of the conversation (extracted or user-provided) |
| `date` | string | Start datetime in `YYYY-MM-DD HH:MM` format |
| `topics` | array | Topics discussed, each containing idea units |

### Topic

| Field | Type | Description |
|-------|------|-------------|
| `topic_id` | string | Unique identifier (e.g. `topic_001`) |
| `name` | string | Short topic name (2-5 words), in conversation language |
| `short_description` | string | Dense summary, max 50 tokens, in conversation language |
| `long_description` | string | Comprehensive description, max 500 tokens, in conversation language |
| `idea_units` | array | Idea units assigned to this topic, ordered chronologically |

### Idea Unit

| Field | Type | Description |
|-------|------|-------------|
| `turn_id` | string | ID of the source turn (e.g. `turn_001`) |
| `speaker` | string | Name of the speaker |
| `time` | string | Absolute timestamp (`YYYY-MM-DD HH:MM` or `YYYY-MM-DD HH:MM:SS`). Falls back to relative `HH:MM` if start date is unavailable. |
| `sentences` | array[string] | Consecutive sentences forming one coherent idea |
| `category` | string | One of: Issue, Position, Argument, Information, Agreement, Decision |

## Notes

- Irrelevant idea units are discarded during extraction and do not appear in the output.
- Idea units within a topic are ordered by their original chronological position.
- Topics with no idea units may exist in the file but carry no content.

---

# Decision Record Output Format

Decision records are written as individual JSON files in a `{baseName}_decisions/` directory next to the original file. Each file captures one software design or implementation decision extracted from a topic.

## File Naming

Files are named `{topic_id}_decision_{NNN}.json` where `NNN` is a zero-padded 3-digit sequential index per topic (e.g. `topic_001_decision_001.json`, `topic_001_decision_002.json`).

## Schema

```json
{
  "topic_id": "topic_001",
  "topic_name": "Topic Name",
  "context": "Problem description synthesized from Issue-category idea units",
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

## Field Descriptions

| Field | Type | Description |
|-------|------|-------------|
| `topic_id` | string | ID of the source topic (e.g. `topic_001`) |
| `topic_name` | string | Name of the source topic, for self-containment |
| `context` | string | Problem description synthesized from Issue-category idea units |
| `decision` | object | The chosen option with `description`, `rationale`, and `consequences` |
| `alternative_options` | array | Rejected alternatives, each with `description` and `rejection_rationale`. Empty array if no alternatives discussed. |
| `design_concerns` | array[string] | One or more of: `BusinessRule`, `DomainModel`, `QualityAttribute`, `Technology`, `Infrastructure`, `Other` |

## Scope

Only **software design and implementation decisions** are captured — technology choices, architecture, API design, data models, quality attributes. Organizational, business, and project management decisions are excluded.
