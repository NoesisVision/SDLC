# Conversation cleaning
Status: In progress

## Goal

Create a new MCP tool in noesis_local server that cleans conversations.

## Input format

The input format is a markdown file with the following structure:
```markdown
# {Title}
{Date}
**{Time}**
{Speaker}
{Text}
**{Time}**
{Speaker}
{Text}
```
Title is the name of the conversation. It's optional.
Date is the date of the conversation in the format YYYY-MM-DD. It's optional.
The time is in the format HH:MM.
Speaker is the name of the speaker. If it's not known, it's just "Speaker1".
Text can contain many sentences and many lines.

## Output format

JSON

Output should be a JSON object with the following structure:
```json
{
  "title": "system modularization",
  "date": "2026-02-19 12:13",
  "statements": [
    {
      "speaker": "Jan Kowalski",
      "time": "01:02",
      "sentences": [
        "In my opinion wh should do A",
        "Without that it will not work"
      ]
    }
  ]
}
```

## Requirements
- Fix broken syntax eg. unnecessary line breaks.
- Trim whitespaces.
- Remove empty lines.
- Split each {Text} into individual sentences using spaCy to handle abbreviations and punctuation correctly.
- If the title or date is missing, ask the user to enter it using back call to AI agent.