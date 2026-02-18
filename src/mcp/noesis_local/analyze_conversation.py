"""Conversation file analysis tool for the Noesis Local MCP server."""

import json
from pathlib import Path

from mcp.server.fastmcp import Context
from mcp.types import SamplingMessage, TextContent
from pydantic import BaseModel, Field, ValidationError


class DomainTerm(BaseModel):
    """Domain term with its definition."""

    term: str = Field(description="Domain-specific term found in the conversation")
    definition: str = Field(description="Definition or explanation of the term")


class Topic(BaseModel):
    """Conversation topic with summary."""

    title: str = Field(description="Title or name of the topic")
    summary: str = Field(description="Short summary of what was discussed about this topic")


class AnalyzeConversationFileResponse(BaseModel):
    """Response from conversation file analysis."""

    summary: str = Field(description="Short summary of the overall conversation")
    domain_terms: list[DomainTerm] | None = Field(
        default=None,
        description="List of domain-specific terms with their definitions (if any identified)",
    )
    topics: list[Topic] = Field(
        min_length=1,
        description="List of topics discussed in the conversation",
    )


CONVERSATION_ANALYSIS_PROMPT = """You are an expert conversation analyst. Your task is to perform an in-depth analysis of the provided conversation transcript.

Analyze the conversation and provide a structured response with the following components:

1. **Summary**: A concise summary (2-4 sentences) of the overall conversation, capturing the main purpose and outcome.

2. **Domain Terms**: Identify domain-specific terminology used in the conversation. Only include terms that:
   - Are specific to a particular field, technology, or domain
   - Have enough context in the conversation to provide a meaningful definition
   - Would benefit from explanation
   If no clear domain terms are identified, you may omit this section.

3. **Topics**: Break down the conversation into distinct topics that were discussed. For each topic:
   - Provide a clear, descriptive title
   - Write a brief summary (1-3 sentences) of what was discussed

Return your analysis in the following JSON format:

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

IMPORTANT:
- Return ONLY valid JSON, no markdown code blocks, no additional explanations
- The "domain_terms" field can be null or an empty array if no domain terms are identified
- The "topics" array must contain at least one topic
- Be concise but informative

Here is the conversation to analyze:

{conversation}"""


async def analyze_conversation_file(
    file_path: str,
    ctx: Context,
) -> AnalyzeConversationFileResponse:
    """Analyze a conversation transcript from a file using LLM.

    Performs in-depth conversation analysis including:
    - Overall summary of the conversation
    - Domain-specific terms with definitions (if identifiable)
    - Topics discussed with summaries

    Args:
        file_path: Absolute or relative path to the conversation file.
        ctx: MCP context for LLM access.

    Returns:
        Structured analysis with summary, domain terms, and topics.

    Raises:
        FileNotFoundError: If the file doesn't exist.
        PermissionError: If the file cannot be read.
        ValueError: If the file is invalid or the LLM response is invalid.
        RuntimeError: If analysis fails after retries.
    """
    resolved_path = Path(file_path)

    if not resolved_path.exists():
        raise FileNotFoundError(f"File not found: {resolved_path}")

    if not resolved_path.is_file():
        raise ValueError(f"Path is not a file: {resolved_path}")

    try:
        conversation_text = resolved_path.read_text(encoding="utf-8")
    except PermissionError as e:
        raise PermissionError(f"Permission denied reading file {resolved_path}: {e}")
    except UnicodeDecodeError as e:
        raise ValueError(f"File encoding error (expected UTF-8): {e}")

    if not conversation_text.strip():
        raise ValueError(f"File is empty: {resolved_path}")

    prompt = CONVERSATION_ANALYSIS_PROMPT.replace("{conversation}", conversation_text)

    max_retries = 3
    for attempt in range(max_retries):
        try:
            result = await ctx.session.create_message(
                messages=[
                    SamplingMessage(
                        role="user",
                        content=TextContent(type="text", text=prompt),
                    )
                ],
                max_tokens=8000,
                temperature=0.1,
            )

            response_text = result.content.text.strip()

            if response_text.startswith("```json"):
                response_text = response_text[7:]
            elif response_text.startswith("```"):
                response_text = response_text[3:]

            if response_text.endswith("```"):
                response_text = response_text[:-3]

            response_text = response_text.strip()

            parsed_data = json.loads(response_text)
            return AnalyzeConversationFileResponse(**parsed_data)

        except (json.JSONDecodeError, ValidationError) as e:
            if attempt == max_retries - 1:
                raise RuntimeError(
                    f"Failed to analyze conversation after {max_retries} attempts: {e}"
                )
            prompt += "\n\nIMPORTANT: Return ONLY valid JSON, no markdown, no explanations."

    raise RuntimeError("Analysis failed unexpectedly")
