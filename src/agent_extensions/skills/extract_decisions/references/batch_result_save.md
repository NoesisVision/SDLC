After processing all turns, save all results (new topics, updated topic descriptions, idea units, and discarded units) to a temporary JSON file.
Tmp file path: `{work_dir}/tmp_batch_results.json`.
The file MUST have exactly this format:
```json
{
  "new_topics": [
    {
      "placeholder_id": "new_1",
      "name": "2-5 word label in conversation language",
      "summary": "Dense summary, max 50 tokens",
      "description": "Comprehensive description, max 500 tokens"
    }
  ],
  "updated_topics": [
    {
      "topic_id": "topic_001",
      "name": "Updated name",
      "summary": "Updated summary",
      "description": "Updated comprehensive description"
    }
  ],
  "idea_units": [
    {
      "topic_id": "topic_001",
      "units": [
        {
          "turn_id": "turn_001",
          "speaker": "Name",
          "time": "00:14:30",
          "sentences": ["sentence1", "sentence2"],
          "category": "Position"
        }
      ]
    },
    {
      "topic_id": "new_1",
      "units": [...]
    }
  ],
  "discarded_units": [
    {
      "turn_id": "turn_003",
      "speaker": "Name",
      "time": "00:22:10",
      "sentences": ["ok, rozumiem"],
      "category": "Irrelevant"
    }
  ]
}
```

Key points:
- **New topics:** Use a `placeholder_id` (e.g. `"new_1"`, `"new_2"`) to reference new topics in `idea_units` entries before they get a real ID. The merge script maps placeholders to assigned `topic_ids` automatically.
- **Updated topics:** Include `topic_id` for existing topics whose descriptions should be updated after receiving new idea units.
- **Idea units:** Group idea units by their target `topic_id` (or `placeholder_id` for new topics).
- **Discarded units:** All idea units categorized as `Irrelevant` that are not assigned to any topic.
- **Sentence completeness:** Every sentence from the batch must appear exactly once — either in an `idea_units` group or in `discarded_units`. No sentence may be omitted or duplicated.
- **Verbatim text:** Preserve sentence text exactly as it appears in the source. Do not fix typos, punctuation, or grammar.
- The merge script returns `created_topic_ids` mapping in its output.
