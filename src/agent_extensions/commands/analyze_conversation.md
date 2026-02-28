# Analyze Conversation

Analyze a conversation transcript file to extract a summary, domain terms, and topics.

## Input

Read the conversation file from `$ARGUMENTS`. If no file path is provided, ask the user.

## Instructions

You are an expert conversation analyst. Perform an in-depth analysis of the provided conversation transcript.

Analyze the conversation and provide a structured response with the following components:

1. **Summary**: A concise summary (2-4 sentences) of the overall conversation, capturing the main purpose and outcome.

2. **Domain Terms**: Identify domain-specific terminology used in the conversation. Only include terms that:
   - Are specific to a particular field, technology, or domain
   - Have enough context in the conversation to provide a meaningful definition
   - Would benefit from explanation
   If no clear domain terms are identified, set `domain_terms` to `null`.

3. **Topics**: Break down the conversation into distinct topics that were discussed. For each topic:
   - Provide a clear, descriptive title
   - Write a brief summary (1-3 sentences) of what was discussed

## Output

Return your analysis as a JSON code block in exactly this format:

```json
{
  "summary": "Your overall conversation summary here",
  "domain_terms": [
    {
      "term": "term name",
      "definition": "definition based on conversation context"
    }
  ],
  "topics": [
    {
      "title": "Topic title",
      "summary": "Brief summary of this topic"
    }
  ]
}
```

Rules:
- The `domain_terms` field can be `null` if no domain terms are identified
- The `topics` array must contain at least one topic
- Be concise but informative
