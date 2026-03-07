# Structured Conversation Output Format

The final output is a JSON file matching the `StructuredConversation` schema.

## Schema

```json
{
  "conversation_id": "UUID string",
  "title": "Conversation title",
  "date": "YYYY-MM-DD HH:MM",
  "topics": [
    {
      "name": "2-5 word topic name",
      "summary": "1-3 sentence description of what was discussed",
      "statements": [
        {
          "speaker": "Speaker Name",
          "time": "HH:MM",
          "idea_units": [
            {
              "sentences": ["sentence1", "sentence2"],
              "category": "Issue|Position|Argument|Decision|Irrelevant"
            }
          ]
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
| `topics` | array | Topics discussed, each containing grouped statements |

### Topic

| Field | Type | Description |
|-------|------|-------------|
| `name` | string | Short topic name (2-5 words), in conversation language |
| `summary` | string | 1-3 sentence description, in conversation language |
| `statements` | array | Speaker contributions grouped by speaker+time |

### Statement

| Field | Type | Description |
|-------|------|-------------|
| `speaker` | string | Name of the speaker |
| `time` | string | Time relative to conversation start (HH:MM) |
| `idea_units` | array | Idea units from this speaker on this topic |

### Idea Unit

| Field | Type | Description |
|-------|------|-------------|
| `sentences` | array[string] | Consecutive sentences forming one coherent idea |
| `category` | string | One of: Issue, Position, Argument, Decision, Irrelevant |

## Category Definitions

- **Issue:** question or problem raised for discussion
- **Position:** proposed solution, opinion, or stance
- **Argument:** evidence or reasoning for/against a position
- **Decision:** agreed conclusion or action item
- **Irrelevant:** filler, greetings, procedural remarks
